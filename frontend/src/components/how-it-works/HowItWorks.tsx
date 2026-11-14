import CheckVideoForm from "@/components/CheckVideoForm";
import { asset } from "@/lib/asset";
import { Lead, Section } from "./parts";
import Questions from "./Questions";
import Sampling from "./Sampling";
import Score from "./Score";
import WhatWeMeasure from "./WhatWeMeasure";

// The How it works page (plan 006): one video through a check, steps 1–4, then common questions.

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <Hero />
      <div className="grid gap-8">
        <PasteLink />
        <WhatWeMeasure />
        <Sampling />
        <Score />
        <Questions />
      </div>
    </div>
  );
}

/** The H1, and the kid lying on the first card's top edge. */
function Hero() {
  return (
    <div className="flex items-start justify-between gap-4">
      <h1 className="font-hand text-[2rem] leading-tight font-semibold text-navy sm:text-[2.75rem] lg:text-[3.25rem]">
        How it works
      </h1>
      {/* Elbows and laptop rest on the card's border (the art's floor is 86 % down the image); its top
          (13 % down) lines up with the H1's letters. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, images pre-converted */}
      <img
        aria-hidden="true"
        src={asset("/images/kid_wonder.webp")}
        alt=""
        width={648}
        height={432}
        className="relative z-10 -mt-3.5 mr-8 -mb-[2.25rem] hidden h-auto w-61 md:block lg:-mb-[2.4375rem] lg:w-69 xl:-mt-[1.125rem] xl:-mb-[2.75rem] xl:w-81"
      />
    </div>
  );
}

/**
 * Step 1: a slim card with the real check field on the right, on the home card's butter so people
 * see it's the same thing. Title and sentence on the left from lg; stacked below.
 */
function PasteLink() {
  return (
    <Section
      id="paste"
      title="Paste a link"
      step={1}
      className="lg:grid lg:grid-cols-[1fr_auto] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-10"
    >
      <Lead>Paste any YouTube video made for kids.</Lead>
      {/* From lg, its field is as long as the home card's at full width (a 411 px form). */}
      <div className="mt-6 rounded-2xl bg-butter p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:w-[28.25rem]">
        <CheckVideoForm />
      </div>
    </Section>
  );
}
