import { Claim, RecyclingTotals, quantity, tokens, number } from "./api";

export function totalShareTitle(totals: RecyclingTotals) {
  const recycled = [
    totals.bottles > 0 ? `${number(totals.bottles)} bottles` : "",
    totals.cardboard_grams > 0
      ? `${number(totals.cardboard_grams / 1000)} kg cardboard`
      : "",
  ]
    .filter(Boolean)
    .join(" and ");
  return `So far, I've recycled ${recycled || "0 bottles and 0 kg cardboard"} and earned ${tokens(totals.reward_base_units)} LOOP`;
}

export function totalShareCaption(totals: RecyclingTotals) {
  return `${totalShareTitle(totals)}! Every drop-off adds up. #LoopMint #Recycling`;
}

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
