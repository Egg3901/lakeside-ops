"use strict";
// Fast gate for messages that are not explicitly addressed to Keir. Jev (the
// box's typed-decisions router, ~300ms) answers first; when it is unsure or
// unreachable Muse Spark 1.3 contributor on the subscription decides instead.
const { makeSpark, parseObject } = require("./spark");
const SYSTEM = `You route Discord messages for Keir, a bot that helps run the game A House Divided. People also call it Keith or Starmer.
Given recent channel messages and a final message, decide whether the final message is meant for Keir to act on or answer: a question or request to Keir, a reply continuing an exchange with Keir, an answer to something Keir asked, or an approval/decision Keir is waiting for.
Direct questions to Keir about his Starmer identity and banter addressed to him ARE for Keir. It is NOT for Keir when people talk about him to each other, joke or banter with other humans, react without addressing him, or continue their own conversation.
Reply with only JSON: {"forKeir": true} or {"forKeir": false}.`;

const JEV = "/root/bin/lib/jev.mjs";
function createClassifier({ jev = (spec) => import(JEV).then((m) => m.yesNo(spec)), onVerdict = () => {}, ...options } = {}) {
  const spark = makeSpark(options);
  async function viaJev({ transcript, message }) {
    try {
      const r = await jev({ state: { recent: transcript.slice(-12).map((r) => `${r.role === "assistant" ? "Keir" : `${r.author} (${r.role})`}: ${r.content}`), final: `${message.author} (${message.role}): ${message.content}` },
        instruction: "Keir is a Discord bot that helps run the game A House Divided (also called Keith or Starmer). Decide whether the final message is meant for Keir to act on or answer.",
        yes: "The final message asks Keir something, gives Keir an instruction or decision, or answers or continues an exchange with Keir.",
        no: "The final message talks about Keir to other people, jokes or banters with other humans, reacts without addressing him, or continues a conversation between humans.", timeoutMs: 5000 });
      return r && r.decisive ? r : null;
    } catch { return null; }
  }
  async function classify(input) {
    const fast = await viaJev(input);
    if (fast) { onVerdict({ via: "jev", forKeir: fast.value, probability: fast.probability }); return fast.value; }
    const slow = await viaMuse(input);
    onVerdict({ via: "luna", forKeir: slow }); return slow;
  }
  return classify;
  async function viaMuse({ transcript, message }) {
    const prompt = JSON.stringify({ recent: transcript.slice(-12).map((r) => `${r.role === "assistant" ? "Keir" : `${r.author} (${r.role})`}: ${r.content}`), final: `${message.author} (${message.role}): ${message.content}` });
    // Any failure keeps Keir quiet rather than interrupting.
    return parseObject(await spark(SYSTEM, prompt))?.forKeir === true;
  }
}
// Is this public post a concrete problem that support should ticket? Decisive
// "no" dismisses the candidate cheaply; "yes" or unsure goes to a full review.
async function screenReport({ transcript, message, jev = (spec) => import(JEV).then((m) => m.yesNo(spec)) }) {
  try {
    const r = await jev({ state: { recent: transcript.slice(-8).map((r) => `${r.author || r.role} (${r.role}): ${r.content}`), final: `${message.author}: ${message.content}${message.images ? ` [${message.images} image(s) attached]` : ""}` },
      instruction: "A House Divided is an online political/economic strategy game. Decide whether the final public Discord message reports a concrete problem with the game that support should open a ticket for.",
      yes: "It reports a bug, error, broken or missing feature, wrong number or result, lost money/items/progress, or an account problem the player is experiencing.",
      no: "It is banter, a joke, a meme or reaction image, an opinion, strategy talk, a balance wish, roleplay, a screenshot shared for fun, or a question already being answered by others.", timeoutMs: 5000 });
    return r && r.decisive ? r : null;
  } catch { return null; }
}
module.exports = { createClassifier, screenReport };
