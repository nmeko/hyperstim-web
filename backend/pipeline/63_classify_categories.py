#!/usr/bin/env python3
"""
Category classification for the contemporary v2 corpus.

Implements plan-2026-08-24-contemporary-reclassification.md as revised
2026-08-27. It is a rewrite of runs/label-50/classify_v2.py, not an edit:
that script's E1 (non-English), E2 (pre-2015), channel field and '- Topic'
short-circuit are all gone, and its keyword set is replaced.

  §2  field precedence : title -> tags -> description. First field that fires
                         decides. Channel is not read.
  §3  keyword set      : one human-given list, no per-field scoping.
  §4  category order   : gaming -> music -> narrative -> play -> educational,
                         resolving multiple hits WITHIN the deciding field.

There is no exclusion gate. Every manifest row gets a category or UNREACHED.
E0 -- did the clip download correctly as an mp4 -- is deferred to extraction
time and is not asked here.

Every field is matched twice, raw and camelCase-normalised, because \\b slides
off glued forms: 'ToysReview', 'HobbyGaming', 'kidsongs'.

Writes a TSV of verdicts and, with --json, a per-video record carrying every
category's hits in every field -- what the review page needs to show why a
video landed where it did.
"""
import argparse, csv, json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

FIELDS = ["title", "tag", "desc"]
ORDER = ["gaming", "music", "narrative", "play", "educational"]
LABEL = {"gaming": "Gaming", "music": "Music", "narrative": "Narrative",
         "play": "Play & Activity", "educational": "Educational"}

# --------------------------------------------------------------------------
# §3 THE KEYWORD SET. Left column is the term exactly as the human wrote it;
# right column is how it is matched (§3 "How each term is matched"): optional
# plural on nouns, stor(y|ies), prefix on learn/science, flexible spacing and
# hyphens on the two-word terms.
LEXICON = {
    "music": [
        ("song",                    r"\bsongs?\b"),
        ("nursery rhyme",           r"\bnursery\s*-?rhymes?\b"),
        ("sing along",              r"\bsing[\s-]?alongs?\b"),
        ("music",                   r"\bmusic\b"),
        ("kidsong",                 r"\bkids?\s?-?songs?\b"),
        ("lyrics",                  r"\blyrics?\b"),
    ],
    "narrative": [
        ("story",                   r"\bstor(y|ies)\b"),
        ("fairy tale",              r"\bfairy\s?-?tales?\b"),
        ("cartoon",                 r"\bcartoons?\b"),
        ("full episode",            r"\bfull\s+episodes?\b"),
        ("read-aloud",              r"\bread\s?-?alouds?\b"),
    ],
    "educational": [
        ("learn",                   r"\blearn(s|t|ed|ing|ings)?\b"),
        ("study",                   r"\bstud(y|ies|ied|ying)\b"),
        ("education",               r"\beducation(s|al)?\b"),
        ("STEM",                    r"\bstem\b"),
        ("science",                 r"\bscien(ce|ces|tific)\b"),
        ("math",                    r"\bmath(s|ematics)?\b"),
        ("knowledge",               r"\bknowledge\b"),
        ("vocabulary",              r"\bvocabular(y|ies)\b"),
        ("grammar",                 r"\bgrammars?\b"),
        ("phonics",                 r"\bphonics?\b"),
        ("history",                 r"\bhistor(y|ies|ical)\b"),
        ("lesson",                   r"\blesson(s|es)?\b"),
        ("experiment",               r"\bexperiment(s|es)?\b"),
    ],
    "gaming": [
        ("game",                    r"\bgames?\b"),
        ("gaming",                  r"\bgaming\b"),
        ("gameplay",                r"\bgame\s?-?plays?\b"),
        ("roblox",                  r"\broblox\b"),
        ("minecraft",               r"\bminecrafts?\b"),
        ("nintendo",                r"\bnintendo\b"),
        ("racing",                   r"\bracing(s|es)?\b"),
    ],
    "play": [
        ("DIY",                     r"\bdiy\b"),
        ("craft",                   r"\bcraft(s|ing)?\b"),
        ("draw",                    r"\bdraw(s|ing|ings)?\b"),
        ("toy",                     r"\btoys?\b"),
        ("exercise",                r"\bexercis(e|es|ing)\b"),
        ("workout",                 r"\bwork\s?-?outs?\b"),
        ("swim",                    r"\bswim(s|ming|mers?)?\b"),
        ("dance",                   r"\bdanc(e|es|ed|ing|ers?)\b"),
        ("vlog",                    r"\bvlog(s|ging|gers?)?\b"),
        ("painting",                r"\bpaint(s|ed|ing|ings)?\b"),
        ("fitness",                 r"\bfitness\b"),
        ("play",                    r"\bplay(s|ing|ed)?\b"),
        ("challenge",               r"\bchallenges?\b"),
        ("yoga",                     r"\byoga(s|es)?\b"),
        ("zumba",                    r"\bzumba(s|es)?\b"),
        ("lego",                     r"\blego(s|es)?\b"),
    ],
}

# --------------------------------------------------------------------------
# Normalisation. "ToysReview" -> "Toys Review". Matching runs over raw AND
# normalised, so a term hits either way.
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_SEP = re.compile(r"[-_./+|]+")


def normalise(t):
    return _SEP.sub(" ", _CAMEL.sub(" ", t or ""))


def variants(t):
    """The raw text and, when it differs, its normalised form. Kept separate
    rather than concatenated so a match's offsets stay usable against the raw
    string the review page displays."""
    t = t or ""
    n = normalise(t)
    return [t] if n == t else [t, n]


COMPILED = {c: [(term, re.compile(pat, re.I)) for term, pat in terms]
            for c, terms in LEXICON.items()}


def hits(text, cat):
    """Terms of `cat` that fire in `text`, with the substrings that fired and
    their offsets in the RAW text (offsets omitted for normalised-only hits)."""
    out = []
    forms = variants(text)
    for term, pat in COMPILED[cat]:
        got, spans = [], []
        for i, f in enumerate(forms):
            for m in pat.finditer(f):
                s = m.group(0)
                if s.lower() not in [g.lower() for g in got]:
                    got.append(s)
                if i == 0:
                    spans.append([m.start(), m.end()])
        if got:
            out.append({"term": term, "matched": got, "spans": spans})
    return out


def classify(row):
    """§2 then §4. Returns the full picture, not just the verdict, so the
    review page can show the sequence rather than assert the answer."""
    detail = {f: {} for f in FIELDS}
    for f in FIELDS:
        text = row.get(f) or ""
        if not text:
            continue
        for cat in ORDER:
            h = hits(text, cat)
            if h:
                detail[f][cat] = h
    for f in FIELDS:                       # §2 first field that fires decides
        fired = [c for c in ORDER if c in detail[f]]     # §4 order within it
        if fired:
            return fired[0], f, fired, detail
    return None, None, [], detail


def evidence_str(detail, cat, fld):
    if not fld or not cat:
        return ""
    seen, out = set(), []
    for h in detail[fld].get(cat, []):
        for m in h["matched"]:
            if m.lower() not in seen:
                seen.add(m.lower()); out.append(m)
    return "; ".join(out[:8])


def unescape(s):
    return (s or "").replace("\\n", "\n")


def load(manifests, meta_path):
    meta = {}
    with open(meta_path) as f:
        for r in csv.DictReader(f, delimiter="\t"):
            meta[r["video_id"]] = r
    rows, seen = [], set()
    for m in manifests:
        share = re.search(r"share-(\d+)", m)
        with open(m) as f:
            for r in csv.DictReader(f, delimiter="\t"):
                v = r["video_id"]
                if v in seen:
                    continue
                seen.add(v)
                md = meta.get(v, {})
                rows.append({
                    "video_id": v,
                    "title": md.get("title", ""),
                    "tag": md.get("tags", ""),
                    "desc": unescape(md.get("description", "")),
                    "chan": r["channel_title"],
                    "channel_id": r["channel_id"],
                    "year": r["year"],
                    "published_at": r["published_at"],
                    "views": r["view_count"],
                    "duration_s": r["duration_s"],
                    "share": share.group(1) if share else "",
                    "has_meta": v in meta,
                })
    return rows


# The 2026-08-28 review rounds, in the order they were entered. Kept as TSVs
# rather than folded into the lexicon, because a hand verdict is evidence about
# one video and a keyword is a claim about the corpus.
#
#   round 1  144 verdicts, 134 of them on videos no rule reached.
#   round 2  157, a superset: the same 144 with identical categories on every
#            one of them, plus 13 more, 9 of which are share-5-amend videos the
#            first round could not have seen. It was written on 2026-08-28 and
#            nothing read it until 2026-08-29, so those 13 human verdicts sat
#            unused while the file existed.
#
# Later files win on overlap, which on these two changes nothing.
HAND_LABEL_ROUNDS = ["runs/contemporary-v2/hand-labels-2026-08-28.tsv",
                     "runs/contemporary-v2/hand-labels-2026-08-28-round2.tsv"]


def hand_labels_v2(repo):
    out = {}
    for rel in HAND_LABEL_ROUNDS:
        p = os.path.join(repo, rel)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                if r["category"] in ORDER:
                    out[r["video_id"]] = r["category"]
    return out


def human_labels(repo):
    """Every hand verdict we hold, as ground truth. A video a person has ruled
    on is never re-decided by a regex."""
    out = {}
    for p in ("runs/label-50/labels-2026-08-24.json",
              "runs/unclassified-review/labels-round2.json",
              "runs/unclassified-48/labels-round3.json",
              "runs/audit-50/labels-audit.json"):
        p = os.path.join(repo, p)
        if not os.path.exists(p):
            continue
        for l in json.load(open(p))["labels"]:
            v = l.get("verdict") or l.get("cat")
            if v == "ok":
                v = l.get("pred")
            if v in ORDER:
                out[l["id"]] = v
    out.update(hand_labels_v2(repo))      # the newer round wins on any overlap
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", action="append", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--out", required=True, help="TSV of verdicts")
    ap.add_argument("--json", help="per-video match detail for the review page")
    ap.add_argument("--no-hand-labels", action="store_true")
    a = ap.parse_args()

    rows = load(a.manifest, a.meta)
    HUM = {} if a.no_hand_labels else human_labels(REPO)

    res = collections.Counter()
    by_field = collections.Counter()
    multi = collections.Counter()
    term_use = collections.Counter()
    n_hum = no_meta = 0
    recs, blobs = [], []

    for r in rows:
        cat, fld, fired, detail = classify(r)
        if not r["has_meta"] or not (r["title"] or r["tag"] or r["desc"]):
            no_meta += 1
        rule = "UNREACHED" if cat is None else fld
        if r["video_id"] in HUM:
            cat, rule = HUM[r["video_id"]], "hand label"
            n_hum += 1
        res[cat or "UNREACHED"] += 1
        by_field[rule] += 1
        if fld and len(fired) > 1:
            multi[len(fired)] += 1
        ev = evidence_str(detail, cat, fld) if rule in FIELDS else ""
        for h in detail.get(fld, {}).get(cat, []) if rule in FIELDS else []:
            term_use[(cat, h["term"])] += 1
        recs.append({"video_id": r["video_id"], "category": cat or "",
                     "decided_by": rule, "evidence": ev,
                     "year": r["year"], "share": r["share"],
                     "channel_title": r["chan"], "title": r["title"]})
        if a.json:
            blobs.append({**{k: r[k] for k in ("video_id", "title", "tag", "desc",
                                               "chan", "channel_id", "year",
                                               "published_at", "views",
                                               "duration_s", "share")},
                          "category": cat or "", "decided_by": rule,
                          "fired_in_field": fired, "detail": detail})

    cols = ["video_id", "category", "decided_by", "evidence", "year", "share",
            "channel_title", "title"]
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter="\t",
                           extrasaction="ignore")
        w.writeheader()
        for r in recs:
            w.writerow({k: str(r[k]).replace("\t", " ") for k in cols})
    if a.json:
        json.dump(blobs, open(a.json, "w"), ensure_ascii=False)

    n = len(rows)
    print(f"=== contemporary v2, n = {n} ===")
    for k in ORDER + ["UNREACHED"]:
        v = res[k]
        print(f"  {LABEL.get(k, k):<16} {v:>6}  {100*v/n:>5.1f}%")
    print("\n  decided by:")
    for k, v in by_field.most_common():
        print(f"    {k:<12} {v:>6}  {100*v/n:>5.1f}%")
    settled = n - res["UNREACHED"]
    if settled:
        print(f"\n  of the {settled} settled, {sum(multi.values())} "
              f"({100*sum(multi.values())/settled:.1f}%) had more than one "
              f"category fire in the deciding field")
    print(f"  hand labels applied: {n_hum}")
    print(f"  no usable metadata:  {no_meta}")
    print(f"\n  wrote {len(recs)} rows -> {a.out}")
    if a.json:
        print(f"  wrote match detail -> {a.json}")

    print("\n  top terms, by the verdicts they carried:")
    for (c, t), v in term_use.most_common(20):
        print(f"    {LABEL[c]:<16} {t:<26} {v:>6}")


if __name__ == "__main__":
    main()
