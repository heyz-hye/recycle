"use client";
import type { Center } from "@/lib/api";
import { PageHeading } from "@/components/ui";
import Dropoff from "@/components/Dropoff";

type Props = {
  centers: Center[];
  busy: boolean;
  onCreateTicket: (data: unknown) => void;
};
export default function DropoffScreen({
  centers,
  busy,
  onCreateTicket,
}: Props) {
  return (
    <>
      <PageHeading
        eyebrow="YOUR NEXT GOOD DEED"
        title="Give it a new beginning."
        text="Tell us what you’re bringing. Your center will confirm the final quantities."
      />
      <Dropoff centers={centers} busy={busy} onSubmit={onCreateTicket} />
    </>
  );
}
