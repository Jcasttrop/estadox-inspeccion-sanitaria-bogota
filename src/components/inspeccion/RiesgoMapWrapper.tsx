"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/Spinner";

const RiesgoMap = dynamic(() => import("./RiesgoMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[600px] w-full flex items-center justify-center bg-gray-100 rounded-xl">
      <Spinner />
    </div>
  ),
});

export default function RiesgoMapWrapper() {
  return <RiesgoMap />;
}
