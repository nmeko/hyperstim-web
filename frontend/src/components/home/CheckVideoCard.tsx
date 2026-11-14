"use client";

import { useId } from "react";
import CheckVideoForm from "@/components/CheckVideoForm";
import { asset } from "@/lib/asset";

export default function CheckVideoCard() {
  const id = useId();

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="relative rounded-[2rem] bg-butter px-5 py-8 sm:px-8 md:pb-24"
    >
      <h2 id={`${id}-heading`} className="font-hand text-2xl font-semibold text-navy sm:text-3xl">
        Check a video
      </h2>

      <CheckVideoForm className="mt-6" />

      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-3 hidden items-end md:flex">
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative */}
        <img src={asset("/images/grass_1.webp")} alt="" width={220} height={268} className="h-24 w-auto" />
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative */}
        <img src={asset("/images/flower_1.webp")} alt="" width={260} height={239} className="-ml-4 h-20 w-auto" />
      </div>
    </section>
  );
}
