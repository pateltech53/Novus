import type { Metadata } from "next";
import { InstitutionsStory } from "@/components/product/InstitutionsStory";
import { OG_IMAGE, absoluteUrl } from "@/lib/seo";

/**
 * The institution's side of /product: classrooms, clubs, summer programs and
 * competitions. The other door is /product/you.
 */
export const metadata: Metadata = {
  title: "Novus for institutions — entrepreneurship, practiced",
  description:
    "Give every student a company of their own to run, and a trained investor panel to face — out loud, on camera, against your curriculum and your rubric. Seat licences for classrooms, clubs, summer programs and competitions, with a season board that money can't rank.",
  alternates: { canonical: absoluteUrl("/product/institutions") },
  openGraph: {
    type: "website",
    url: absoluteUrl("/product/institutions"),
    title: "Novus for institutions — entrepreneurship, practiced",
    description:
      "A company per student, a pitch per year, a rubric that can be yours. Chapters seat a whole class in minutes.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Novus" }],
  },
};

export default function ProductInstitutionsPage() {
  return <InstitutionsStory />;
}
