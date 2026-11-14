"""The collector: grows the dataset in the background (plan 013).

It keeps every channel's upload list, picks eligible uploads by their fixed random number
(`sampling.rank`), downloads and measures them with the live analysis's pipeline, and
exports the added videos as TSV files that the API reloads. Run it as its own process:
`python -m hyperstim_api.collector run`.
"""
