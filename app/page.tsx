import { Suspense } from "react";
import Terminal from "@/components/Terminal";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="main">Loading the terminal…</div>}>
      <Terminal />
    </Suspense>
  );
}
