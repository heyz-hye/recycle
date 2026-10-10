"""LoopMint Assistant: a recycling-only chat helper with read-only tools.

The assistant never approves claims, changes reward amounts, or moves funds.
The authenticated user always comes from the session (see ..auth.current_user);
it is never taken from chat text, so one user can never read another's data.
"""

from google.genai import types
from ..config import get_settings
from . import gemini_client
from .common import now
from ..schemas import NoArgs, PrepGuideArgs, EstimateRewardArgs, ImpactPeriodArgs

MAX_TOOL_STEPS = 4

SYSTEM_INSTRUCTION = (
    "You are LoopMint Assistant, a focused helper for the LoopMint recycling-rewards app. "
    "Only answer questions about: preparing bottles or cardboard for drop-off, estimating "
    "LOOP rewards, the signed-in user's own rewards and wallet, community recycling impact, "
    "and participating centers. Politely decline anything unrelated to LoopMint recycling. "
    "You cannot approve claims, change reward amounts, or move funds — only center staff and "
    "the Python worker can do that; never imply otherwise. Reward estimates are estimates only; "
    "center staff determine the final accepted quantity and reward after physical inspection. "
    "LOOP is a Solana Devnet demo token with no real monetary value; say so if asked about value. "
    "Use the provided tools to look up real data instead of guessing numbers."
)

PREP_GUIDES = {
    "bottles": {
        "accepted": [
            "Empty plastic bottles with liquid poured out",
            "A quick rinse to remove sticky residue",
            "Labels can stay on; caps on or off are both fine",
        ],
        "rejected": [
            "Bottles still containing liquid or food waste",
            "Non-bottle plastics (bags, clamshells, styrofoam)",
            "Bottles that previously held hazardous chemicals",
        ],
    },
    "cardboard": {
        "accepted": [
            "Clean, dry cardboard, flattened if possible",
            "Most tape and labels removed",
            "Free of food residue or grease",
        ],
        "rejected": [
            "Wet, soiled, or moldy cardboard",
            "Greasy pizza boxes or food-soaked boxes",
            "Wax-coated or plastic-laminated cardboard",
        ],
    },
}


def get_preparation_guide(c, user, args: PrepGuideArgs):
    guide = PREP_GUIDES[args.material]
    return {
        "material": args.material,
        "accepted": guide["accepted"],
        "rejected": guide["rejected"],
        "note": "Center staff make the final call on what is accepted.",
    }


def estimate_reward(c, user, args: EstimateRewardArgs):
    rule = c.one("SELECT * FROM reward_rules WHERE material=?", (args.material,))
    quantity_in_rule_units = args.quantity * (1000 if args.material == "cardboard" else 1)
    amount_base_units = round(
        quantity_in_rule_units * rule["rate_base_units"] / rule["denominator"]
    )
    return {
        "material": args.material,
        "quantity": args.quantity,
        "unit": "kg" if args.material == "cardboard" else "bottles",
        "estimated_amount_base_units": amount_base_units,
        "estimated_loop": amount_base_units / 100,
        "is_estimate": True,
        "note": (
            "This is only an estimate computed from the current reward rate. "
            "Center staff decide the real accepted quantity and reward after inspection."
        ),
    }


def get_my_rewards(c, user, args: NoArgs):
    rewards = c.all(
        "SELECT r.id, r.claim_id, r.amount_base_units, r.state, r.signature, r.created_at, "
        "r.confirmed_at FROM rewards r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 20",
        (user["id"],),
    )
    for reward in rewards:
        reward["explorer_url"] = (
            f"https://explorer.solana.com/tx/{reward['signature']}?cluster=devnet"
            if reward["state"] == "confirmed"
            and reward["signature"]
            and not reward["signature"].startswith("demo:")
            else None
        )
    return {
        "rewards": rewards,
        "note": (
            "Only rewards in the 'confirmed' state have actually been paid. "
            "awaiting_funding, queued, and sent are not yet paid. "
            "LOOP is a Solana Devnet demo token with no real monetary value."
        ),
    }


def get_community_impact(c, user, args: ImpactPeriodArgs):
    since = (
        0
        if args.period == "all"
        else now() - (86400 if args.period == "today" else 604800)
    )
    if get_settings().timescale_enabled:
        totals = c.one(
            "SELECT COALESCE(SUM(CASE WHEN material='bottles' AND event_type='intake' THEN quantity ELSE 0 END),0) AS bottles, "
            "COALESCE(SUM(CASE WHEN material='cardboard' AND event_type='intake' THEN quantity ELSE 0 END),0) AS cardboard_grams "
            "FROM recycling_hourly WHERE hour>=?",
            (since,),
        )
    else:
        totals = c.one(
            "SELECT COALESCE(SUM(CASE WHEN material='bottles' AND event_type='intake' THEN quantity ELSE 0 END),0) AS bottles, "
            "COALESCE(SUM(CASE WHEN material='cardboard' AND event_type='intake' THEN quantity ELSE 0 END),0) AS cardboard_grams "
            "FROM recycling_events WHERE created_at>=?",
            (since,),
        )
    dropoffs = c.one(
        "SELECT COUNT(*) AS n FROM claims WHERE status='verified' AND created_at>=?",
        (since,),
    )["n"]
    return {
        "period": args.period,
        "label": "Verified intake for recycling",
        "bottles": totals["bottles"],
        "cardboard_kg": totals["cardboard_grams"] / 1000,
        "confirmed_dropoffs": dropoffs,
        "note": (
            "Each confirmed drop-off is counted once. This reflects center-verified "
            "intake, not proof of downstream processing. No CO2 estimates are provided."
        ),
    }


def list_centers(c, user, args: NoArgs):
    centers = c.all(
        "SELECT c.id, c.name, c.address, l.latitude, l.longitude FROM centers c "
        "LEFT JOIN center_locations l ON l.center_id=c.id ORDER BY c.name"
    )
    return {"centers": centers}


TOOLS = {
    "get_preparation_guide": (
        get_preparation_guide,
        PrepGuideArgs,
        "Get how to prepare plastic bottles or dry cardboard for drop-off, and what gets rejected.",
    ),
    "estimate_reward": (
        estimate_reward,
        EstimateRewardArgs,
        "Estimate the LOOP reward for a quantity of bottles (count) or cardboard (kg). "
        "This is always an estimate; staff decide the real reward.",
    ),
    "get_my_rewards": (
        get_my_rewards,
        NoArgs,
        "Get the signed-in user's own reward claims and their real state "
        "(awaiting_funding / queued / sent / confirmed), with explorer links for confirmed rewards.",
    ),
    "get_community_impact": (
        get_community_impact,
        ImpactPeriodArgs,
        "Get verified community recycling intake (bottles and cardboard, reported separately) "
        "for a period: today, week, or all.",
    ),
    "list_centers": (
        list_centers,
        NoArgs,
        "List participating recycling centers.",
    ),
}


def _declarations():
    return [
        types.FunctionDeclaration(
            name=name,
            description=description,
            parametersJsonSchema=model.model_json_schema(),
        )
        for name, (fn, model, description) in TOOLS.items()
    ]


def chat(c, user, message):
    g = gemini_client.client()
    if g is None:
        return {
            "reply": "The LoopMint Assistant isn't configured yet. Please check back soon.",
            "configured": False,
        }
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=_declarations())],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [types.Content(role="user", parts=[types.Part(text=message)])]
    for _ in range(MAX_TOOL_STEPS):
        response = g.models.generate_content(
            model=get_settings().gemini_model, contents=contents, config=config
        )
        calls = response.function_calls or []
        if not calls:
            text = (response.text or "").strip()
            return {
                "reply": text or "I'm not sure how to help with that.",
                "configured": True,
            }
        contents.append(response.candidates[0].content)
        parts = []
        for call in calls:
            tool = TOOLS.get(call.name)
            if not tool:
                result = {"error": "Unknown tool."}
            else:
                fn, model, _ = tool
                try:
                    args = model(**(call.args or {}))
                    result = fn(c, user, args)
                except Exception as exc:
                    result = {"error": str(exc)}
            parts.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name=call.name, response=result
                    )
                )
            )
        contents.append(types.Content(role="user", parts=parts))
    return {
        "reply": "I wasn't able to finish that request. Please ask again more specifically.",
        "configured": True,
    }
