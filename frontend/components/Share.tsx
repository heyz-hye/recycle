"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Download, Share2, Check, ExternalLink } from "lucide-react";
import { Claim, quantity, tokens } from "@/lib/api";
import {
  canShareReward,
  shareCaption,
  shareTitle,
  socialComposeLinks,
} from "@/lib/sharing";
import Modal from "./Modal";
const disclaimer = "Solana Devnet demo tokens - no real monetary value.";
export default function Share({
  claim,
  demo,
  onClose,
}: {
  claim: Claim;
  demo: boolean;
  onClose: () => void;
}) {
  const items = claim.items.filter((i) => (i.accepted_quantity || 0) > 0);
  const received = canShareReward(claim);
  const label = demo
    ? "Simulated demo tokens - no real monetary value."
    : disclaimer;
  const [caption, setCaption] = useState(() => shareCaption(claim));
  const links = socialComposeLinks(shareTitle(claim), caption);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.fillStyle = "#173e35";
    c.fillRect(0, 0, 1080, 1080);
    c.strokeStyle = "#30574b";
    c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(1030, 130, 180 + i * 85, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = "#c7ed8b";
    c.font = "bold 34px sans-serif";
    c.fillText("↻  loopmint", 80, 100);
    c.fillStyle = "#c2d5cb";
    c.font = "22px sans-serif";
    c.fillText("CENTER-CONFIRMED RECYCLING INTAKE", 80, 240);
    c.fillStyle = "#ffffff";
    c.font = "bold 76px sans-serif";
    c.fillText("A little action.", 80, 350);
    c.fillText("A lasting difference.", 80, 438);
    c.font = "bold 46px sans-serif";
    items.forEach((i, n) => c.fillText(quantity(i, true), 80, 585 + n * 75));
    if (received) {
      c.fillStyle = "#c7ed8b";
      c.font = "bold 42px sans-serif";
      c.fillText(
        `${tokens(claim.reward!.amount_base_units)} LOOP received`,
        80,
        810,
      );
      c.font = "20px sans-serif";
      c.fillText(label, 80, 858);
    }
    c.fillStyle = "#a9c4b6";
    c.font = "24px sans-serif";
    c.fillText("Small steps. Full circle.  #LoopMint", 80, 987);
  }, [claim, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  const blob = () =>
    new Promise<Blob>((resolve, reject) =>
      canvas.current?.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not create image card.")),
        "image/png",
      ),
    );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback("");
    try {
      await action();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setFeedback(
          e instanceof Error
            ? e.message
            : "Try copying the caption or downloading the card.",
        );
    } finally {
      setBusy(false);
    }
  }
  if (!received)
    return (
      <Modal title="Share your impact" onClose={onClose}>
        <p>
          Your post will be ready once your ticket’s token reward is confirmed.
        </p>
      </Modal>
    );
  return (
    <Modal title="Share your impact" onClose={onClose} wide>
      <p className="muted modal-intro">
        Your reward has arrived. Edit your post, then review and publish it from
        your own X or Reddit account.
      </p>
      <div className="share-grid">
        <canvas
          ref={canvas}
          width={1080}
          height={1080}
          aria-label="Generated recycling achievement card"
        />
        <div>
          <label htmlFor="caption">Your caption</label>
          <textarea
            id="caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={8}
            maxLength={2000}
          />
          <p className="small muted">
            Only confirmed intake and received rewards appear. Your wallet,
            ticket, and private evidence stay private.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => setCaption(shareCaption(claim))}
          >
            Reset to standard template
          </button>
          <div className="button-row" aria-label="Choose a social platform">
            <a
              className="button primary"
              href={links.x}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on X <ExternalLink size={16} />
            </a>
            <a
              className="button primary"
              href={links.reddit}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setFeedback(
                  "In Reddit, choose your profile or a community, review the post, and publish when ready.",
                );
                if (navigator.clipboard) {
                  void navigator.clipboard.writeText(caption).then(
                    () =>
                      setFeedback(
                        "Caption copied. Paste it into Reddit if the post body is blank, then review and publish.",
                      ),
                    () =>
                      setFeedback(
                        "Reddit may leave the post body blank. Copy the caption here and paste it into your post.",
                      ),
                  );
                } else {
                  setFeedback(
                    "Reddit may leave the post body blank. Select and copy the caption here, then paste it into your post.",
                  );
                }
              }}
            >
              Share on Reddit <ExternalLink size={16} />
            </a>
          </div>
          <p className="small muted">
            Sign in on the platform if asked. On Reddit, choose your profile or
            a community. You decide when to publish. Download the card below if
            you want to attach it to your post.
          </p>
          <button
            disabled={busy}
            className="button primary full"
            onClick={() =>
              run(async () => {
                if (!navigator.share) {
                  setFeedback(
                    "Sharing is unavailable here. Copy your caption and download the card to post it yourself.",
                  );
                  return;
                }
                const file = new File(
                  [await blob()],
                  "my-recycling-impact.png",
                  { type: "image/png" },
                );
                await navigator.share(
                  navigator.canShare?.({ files: [file] })
                    ? { files: [file], text: caption }
                    : { text: caption },
                );
              })
            }
          >
            <Share2 size={17} /> Share to your platform
          </button>
          <div className="button-row">
            <button
              disabled={busy}
              className="button secondary"
              onClick={() =>
                run(async () => {
                  if (!navigator.clipboard)
                    throw new Error(
                      "Select the caption above and copy it manually.",
                    );
                  await navigator.clipboard.writeText(caption);
                  setFeedback("Caption copied");
                })
              }
            >
              <Copy size={16} /> Copy caption
            </button>
            <button
              disabled={busy}
              className="button secondary"
              onClick={() =>
                run(async () => {
                  const url = URL.createObjectURL(await blob());
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "my-recycling-impact.png";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setFeedback("Card downloaded");
                })
              }
            >
              <Download size={16} /> Download card
            </button>
          </div>
          <p className="feedback" role="status">
            {feedback && (
              <>
                <Check size={15} /> {feedback}
              </>
            )}
          </p>
        </div>
      </div>
      <div className="modal-footer">
        <p className="small muted">
          Sharing is optional. Your rewards are already yours.
        </p>
        <button className="text-button" onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
