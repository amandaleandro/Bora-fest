import { permanentRedirect } from "next/navigation";

export default function IngressosLegado({ params }: { params: { slug: string } }) {
  permanentRedirect(`/${params.slug}/ingressos`);
}
