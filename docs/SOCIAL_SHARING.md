# Sharing a rewarded ticket

After a ticket is verified **and** its reward reaches `confirmed`, the recycler sees a share prompt and a **Share** button on that ticket's activity row. Dismissing one prompt allows the next rewarded ticket's prompt to appear. The row action remains available afterward. Pending, unfunded, rejected, and unconfirmed rewards do not offer a received-token post.

The editable standard caption and downloadable PNG use only center-accepted quantities and that ticket's confirmed reward amount. They exclude the submitted estimate, ticket code, account/wallet identity, private staff notes, and transaction signature. The standard caption identifies simulated or Solana Devnet tokens as having no real monetary value. **Reset to standard template** restores the generated caption.

- **Share on X** opens the X composer with the edited caption in its `text` parameter. The user signs in if needed, reviews the draft, and publishes themselves. Long edits may need shortening in X.
- **Share on Reddit** opens the text-post submission page with a generated title and caption parameters. It also copies the caption on click because Reddit clients may ignore body-prefill parameters. If clipboard access fails, the caption stays visible for manual copying. The user chooses their profile or a community and publishes themselves.
- **Download card**, **Copy caption**, and the existing device share sheet remain available. Composer links do not upload the PNG; users can attach the downloaded image themselves.

Links open in a new tab with `noopener noreferrer`. LoopMint does not collect social credentials, host posts, submit social posts, or infer publication success from opening a composer. Sharing or cancelling does not change the reward.

Browser tests exercise per-ticket prompts, reward-confirmation gating, accepted rather than estimated quantities, private-field exclusion, edited text and URL encoding, X/Reddit navigation, clipboard fallback, and template reset. External composer pages are intercepted during tests: no real social posts are made. Existing end-to-end tests cover actual reward issuance, image download, and cancelled native sharing in an isolated demo database.

Reddit's [posting guide](https://support.reddithelp.com/hc/en-us/articles/360060422572-How-do-I-post-and-comment-on-Reddit) describes completing posts on its platform. Final login, composer behavior, and publication are controlled by the social platform.
