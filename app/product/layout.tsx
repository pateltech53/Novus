"use client";

import { useStorefront } from "@/lib/commerce";
import { BasicEditionLanding } from "@/components/BasicEditionLanding";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  const where = useStorefront();
  if (where === null) return null;
  return where === "app-store" ? <BasicEditionLanding /> : children;
}
