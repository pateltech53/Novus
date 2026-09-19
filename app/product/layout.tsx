"use client";

import { useStorefront } from "@/lib/commerce";
import { NativeLanding } from "@/components/NativeLanding";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  const where = useStorefront();
  if (where === null) return null;
  return where === "app-store" ? <NativeLanding /> : children;
}
