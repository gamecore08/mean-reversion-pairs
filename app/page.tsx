"use client";

import React, { Suspense } from "react";
import PageClient from "./page-client";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <PageClient />
    </Suspense>
  );
}
