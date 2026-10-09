import { Claim, quantity, tokens } from "./api";

export function canShareReward(claim: Claim) {
  return claim.status === "verified" && claim.reward?.state === "confirmed";
}

export function shareTitle(claim: Claim) {
  if (!canShareReward(claim)) return "My recycling impact";
  const recycled = claim.items
    .filter((item) => (item.accepted_quantity || 0) > 0)
    .map((item) => quantity(item, true))
    .join(" and ");
  return `I recycled ${recycled} and received ${tokens(claim.reward!.amount_base_units)} LOOP`;
}

export function shareCaption(claim: Claim) {
  if (!canShareReward(claim)) return "";
  return `${shareTitle(claim)}! Intake confirmed by my recycling center. #LoopMint #Recycling`;
}

export function socialComposeLinks(title: string, caption: string) {
  const x = new URL("https://x.com/intent/tweet");
  x.searchParams.set("text", caption);
  const reddit = new URL("https://www.reddit.com/submit");
  reddit.searchParams.set("type", "TEXT");
  reddit.searchParams.set("title", title);
  reddit.searchParams.set("text", caption);
  return { x: x.href, reddit: reddit.href };
}
