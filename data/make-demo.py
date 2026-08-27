#!/usr/bin/env python3
"""
Genera data/demo.json: dataset SINTETICO con exactamente el mismo esquema de
pestanas y columnas del Google Sheet real de RPA
(Ticket Buyers, Quiz Responses, Program Buyers, Event Tracker, Lead Magnets).

Sirve para ver, probar y presentar el dashboard ANTES de conectar el Apps
Script, y para no meter datos personales reales en un repo publico.

Determinista (semilla fija). No hay ninguna persona real aqui.
Uso:  python3 data/make-demo.py
"""
import json, random, datetime as dt

random.seed(20260825)

# Fechas de los webinars (una fila por evento en Event Tracker)
WEBINARS = [dt.date(2026, 4, 16), dt.date(2026, 4, 30), dt.date(2026, 5, 14),
            dt.date(2026, 5, 28), dt.date(2026, 6, 25), dt.date(2026, 7, 16),
            dt.date(2026, 7, 30), dt.date(2026, 8, 20)]
QUIZ_LIVE_FROM = dt.date(2026, 5, 26)   # el quiz de intencion se agrego despues
TODAY = dt.date(2026, 8, 25)

SOURCES = ["fb", "ig", "email", "ghl", "website", "direct traffic", ""]
SOURCE_W = [0.54, 0.13, 0.10, 0.08, 0.06, 0.04, 0.05]

MEDIUMS = ["Broad | USA | 35-65+| M+F", "LAL 5% | Purchased | 35-65+| M+F",
           "Broad | CA | 35-65+| M+F | Adv+", "Broad | CA, UK, AUS | 35-65+| M+F | Adv+",
           "TESTING - Broad | USA | 35-65+| M+F", "Broad | AUS | 35-58 | M+F",
           "Broad | IRL | 35-65+| M+F", "RT | Viewed Content, Didn't Buy | 35-65+| M+F | Adv+"]
MEDIUM_W = [0.30, 0.22, 0.12, 0.12, 0.10, 0.05, 0.05, 0.04]

CREATIVES = ["c2-feb copy", "c3-adc4", "c6-feb copy", "Video c18-custom-copy",
             "Video c20-custom-copy", "Video V3 FEB - Copy",
             "Video c19-feb-copy-shortened-hook - Copy", "Image Ad FEB | 1 - Copy",
             "Video C14 Ginger", "c9-feb copy-nh"]
CREATIVE_W = [0.22, 0.12, 0.12, 0.14, 0.13, 0.08, 0.07, 0.05, 0.04, 0.03]

ORG_CAMPAIGNS = ["Webinar Reactivation (Main List)", "ra", "work_with_us",
                 "banner", "email marketing", "homepage"]

TIERS = ["Hot Lead", "Nurture", "Low Intent", "Exclude"]
TIER_W = [0.45, 0.34, 0.14, 0.07]
TIER_SCORES = {"Hot Lead": [83.33, 91.67, 100], "Nurture": [58.33, 66.67, 75],
               "Low Intent": [33.33, 41.67, 50], "Exclude": [25, 50, 83.33]}

Q1 = ["A completely new strategy to rebuild the foundation of our relationship.",
      "Practical steps to improve my own communication and reactions.",
      "A few quick tips or a script to get my child to reply to me."]
Q2 = ["I am ready to change my own behavior and do whatever it takes.",
      "I am willing to try a new perspective, even if it feels uncomfortable.",
      "I just want my child (or my ex) to realize what they are doing is wrong or for someone to get a message to them/intervene."]
Q3 = ["It is my absolute #1 priority; I am ready to focus on this now.",
      "It is important, but other things (work, home repairs, other family issues, travel) are also important to balance.",
      "I  am just gathering information right now to see what works."]
Q4 = ["I am confident that with the right strategy, we can heal this dynamic.",
      "I am skeptical, but I am open to trying a different way.",
      "I've tried everything and doubt anything will change."]
COACH = ["Possibly, depending on whether it feels right and the investment makes sense.",
         "Yes, I'm ready for ongoing coaching support to see this through.",
         "No, I prefer to work through this on my own with self-study resources and tips."]
COACH_W = [0.60, 0.22, 0.18]

PROGRAM_PRICES = [4500.0, 4998.0, 3998.0, 2500.0, 1665.0]
PROGRAM_W = [0.42, 0.22, 0.14, 0.12, 0.10]

FIRST = ["Maria", "Robert", "Linda", "James", "Patricia", "Michael", "Susan", "David",
         "Karen", "John", "Nancy", "Daniel", "Sandra", "Thomas", "Donna", "Paul",
         "Carol", "Mark", "Sharon", "Steven", "Deborah", "Kevin", "Laura", "Brian",
         "Cynthia", "Edward", "Kathleen", "Ronald", "Amy", "Gary", "Angela", "Jeffrey",
         "Melissa", "Scott", "Rebecca", "Eric", "Diane", "Stephen", "Julie", "Andrew",
         "Terry", "Joan", "Craig", "Rhonda", "Doug", "Leni", "Casey", "Erika"]
LAST = ["Miller", "Davis", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson",
        "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
        "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright",
        "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson",
        "Boyd", "Kershaw", "Rider", "Semple", "Cairo", "Straw", "Frew", "Pita"]
DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "hotmail.com",
           "comcast.net", "aol.com", "me.com"]
CC = ["1", "1", "1", "1", "61", "44", "353"]

# --- vocabulario del lead magnet (quiz de reconexion) -------------------------
BARRIERS = ["Ex-partner turned them against me", "A third party is involved",
            "Child pulled away on their own"]
TIME_EST = ["Recent / getting worse", "Less than 3 years", "More than 3 years"]
TRIED = ["Personal therapy", "Court-ordered reunification therapy", "Legal action / court",
         "Coaching for alienation or estrangement", "Support groups", "Gave space",
         "Waiting", "Had someone else reach out", "Reached out directly"]
OUTREACH = ["Ignores me or blocked", "Responds hot/cold or only about money",
            "Responds with insults/threats"]
LOOKING = ["Not ready yet", "Wants to understand first (1 week–2 months)",
           "Ready but finances are tight", "Ready to start within a week"]
CHANNELS = ["Watched Erasing Family Documentary", "Attended a training/webinar",
            "Gets her emails", "Follows on Facebook", "Follows on YouTube",
            "Recommended to her", "New to her", "Saw her on a podcast or news article"]


def pick(o, w=None):
    return random.choices(o, weights=w, k=1)[0]


def money(v):
    return "${:,.2f}".format(v)


def ts(d, lo=6, hi=23):
    t = dt.datetime.combine(d, dt.time(random.randint(lo, hi), random.randint(0, 59)))
    return "{}/{}/{} {}:{:02d}".format(t.month, t.day, t.year, t.hour, t.minute)


def ghl_id():
    a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(random.choice(a) for _ in range(20))


tickets, quizzes, program, leads = [], [], [], []
used = set()

# Cada webinar tiene su ventana de venta de tickets (los ~14 dias previos)
for wi, wdate in enumerate(WEBINARS):
    n_buyers = random.randint(52, 106)
    window_start = wdate - dt.timedelta(days=random.randint(12, 20))

    for _ in range(n_buyers):
        first, last = random.choice(FIRST), random.choice(LAST)
        base = "{}.{}".format(first.lower(), last.lower())
        email = "{}{}@{}".format(base, random.randint(1, 999), random.choice(DOMAINS))
        while email in used:
            email = "{}{}@{}".format(base, random.randint(1, 9999), random.choice(DOMAINS))
        used.add(email)
        phone = "{}{}{}".format(pick(CC), random.randint(200, 989), random.randint(2000000, 9999999)) \
            if random.random() < 0.94 else ""

        # sesgo: la compra se concentra en los ultimos dias antes del webinar
        offset = min(int(abs(random.gauss(0, 5))), (wdate - window_start).days)
        buy_day = wdate - dt.timedelta(days=offset)
        if buy_day > TODAY:
            continue

        src = pick(SOURCES, SOURCE_W)
        is_ads = src in ("fb", "ig") or (src in ("direct traffic", "") and random.random() < 0.7)
        ads_org = "Ads" if is_ads else "Organic"

        if is_ads:
            campaign = "RPA - Alienation Webinar (Purchase) - ABO"
            medium = pick(MEDIUMS, MEDIUM_W)
            content = pick(CREATIVES, CREATIVE_W)
        else:
            campaign = random.choice(ORG_CAMPAIGNS)
            medium = random.choice(["email marketing", "button", "email", "together", ""])
            content = random.choice(["webinar", "tuesday", "wednesday", "thursday", ""])

        gid = ghl_id()
        revenue = 29.0

        tier, score = "", ""
        did_quiz = buy_day >= QUIZ_LIVE_FROM and random.random() < 0.62
        if did_quiz:
            tier = pick(TIERS, TIER_W)
            score = random.choice(TIER_SCORES[tier])

        # cierre del programa
        closed_date, prog_rev, cycle, notes = "", "", "", ""
        hot_bonus = {"Hot Lead": 0.16, "Nurture": 0.07, "Low Intent": 0.02,
                     "Exclude": 0.01, "": 0.07}[tier]
        if wdate <= TODAY and random.random() < hot_bonus:
            cd = wdate + dt.timedelta(days=random.randint(0, 14))
            if cd <= TODAY:
                closed_date = cd.isoformat()
                prog_rev = money(pick(PROGRAM_PRICES, PROGRAM_W))
                cycle = wdate.isoformat()
                notes = random.choice([
                    "Cerró en vivo durante el webinar",
                    "Cerró en el Encore Q&A #1",
                    "Puso el depósito y pagó el saldo días después",
                    "Cerró tras el seguimiento del especialista de inscripción",
                    ""])

        tickets.append({
            "Registration Date": ts(buy_day),
            "First Name": first, "Last Name": last, "Email": email, "Phone": phone,
            "UTM Source Latest": src,
            "UTM Campaign Latest": campaign,
            "UTM Medium Latest": medium,
            "UTM Content Latest": content,
            "Ads or Organic?": ads_org,
            "Revenue": money(revenue),
            "Closed": closed_date,
            "Program Revenue": prog_rev,
            "Quiz Tier": tier,
            "Quiz Score": ("{:.2f}".format(score) if score != "" else ""),
            "Webinar Cycle Closed": cycle,
            "Landing Page": "", "Ticket Checkout Page": "",
            "Notes on enrolment": notes, "Lead Status": "", "Webinar Notes": "",
        })

        program.append({
            "Transaction Date": ts(buy_day),
            "First Name": first, "Last Name": last, "Email": email, "Phone": phone,
            "Amount": money(revenue), "Qualifies for Rev Share?": "Yes" if is_ads else "",
            "UTM Source Latest": src, "UTM Campaign Latest": campaign,
            "UTM Medium Latest": medium, "UTM Content Latest": content,
            "UTM Source First": src, "UTM Campaign First": campaign,
            "UTM Medium First": medium, "UTM Content First": content,
            "GHL ID": gid,
        })

        if did_quiz:
            qday = buy_day + dt.timedelta(days=random.randint(0, 1))
            # ~8% responde el quiz con un email distinto (tipeo o segundo correo)
            qemail = email
            if random.random() < 0.08:
                qemail = email.replace(".com", ".co") if email.endswith(".com") \
                    else "{}{}@{}".format(base, random.randint(1, 99), random.choice(DOMAINS))
            quizzes.append({
                "Submission Date": "{}/{}/{}".format(qday.month, qday.day, qday.year),
                "First Name": first, "Last Name": last, "Email": qemail, "Phone": phone,
                "GHL ID": gid,
                "Overall Score": "{:.2f}".format(score),
                "Tier": tier,
                "Question 1": pick(Q1, [0.45, 0.33, 0.22] if tier == "Hot Lead" else [0.30, 0.32, 0.38]),
                "Question 2": pick(Q2, [0.50, 0.38, 0.12] if tier == "Hot Lead" else [0.25, 0.45, 0.30]),
                "Question 3": pick(Q3, [0.70, 0.22, 0.08] if tier == "Hot Lead" else [0.35, 0.38, 0.27]),
                "Question 4": pick(Q4, [0.45, 0.48, 0.07] if tier == "Hot Lead" else [0.28, 0.52, 0.20]),
                "Interested In Coaching": pick(COACH, COACH_W),
            })

        if closed_date:
            cd = dt.date.fromisoformat(closed_date)
            amount = float(prog_rev.replace("$", "").replace(",", ""))
            if random.random() < 0.35:      # depósito + saldo
                program.append(dict(program[-1], **{
                    "Transaction Date": ts(cd), "Amount": money(500.0),
                    "Qualifies for Rev Share?": "Yes" if is_ads else ""}))
                program.append(dict(program[-1], **{
                    "Transaction Date": ts(cd + dt.timedelta(days=random.randint(1, 6))),
                    "Amount": money(amount - 500.0)}))
            else:
                program.append(dict(program[-1], **{
                    "Transaction Date": ts(cd), "Amount": money(amount)}))

# --- Event Tracker ------------------------------------------------------------
events = []
for wdate in WEBINARS:
    buyers = sum(1 for t in tickets if t["Webinar Cycle Closed"] == wdate.isoformat()) or 0
    buyers_total = len([t for t in tickets
                        if abs((dt.datetime.strptime(t["Registration Date"].split(" ")[0], "%m/%d/%Y").date() - wdate).days) <= 20
                        and dt.datetime.strptime(t["Registration Date"].split(" ")[0], "%m/%d/%Y").date() <= wdate])
    spend = round(random.uniform(2000, 5200), 2)
    lp_views = random.randint(950, 3550)
    attendees = int(buyers_total * random.uniform(0.43, 0.72))
    closes = sum(1 for t in tickets if t["Webinar Cycle Closed"] == wdate.isoformat())
    cash = sum(float(t["Program Revenue"].replace("$", "").replace(",", ""))
               for t in tickets if t["Webinar Cycle Closed"] == wdate.isoformat()) \
        + buyers_total * 29.0
    events.append({
        "Event Date": wdate.isoformat() + " 13:00:00",
        "Event Type": "Alienation Webinar",
        "Ad Spend": money(spend),
        "Total Unique LP Views": "{:,}".format(lp_views),
        "Cost Per View": money(spend / max(lp_views, 1)),
        "Total Buyers": str(buyers_total),
        "Cost Per Buyer (CPL)": money(spend / max(buyers_total, 1)),
        "Opt-in Rate (%)": "{:.2f}%".format(100.0 * buyers_total / max(lp_views / 8.0, 1)),
        "Attendees": str(attendees),
        "Cost Per Attendee": money(spend / max(attendees, 1)),
        "Show-Up Rate (%)": "{:.2f}%".format(100.0 * attendees / max(buyers_total, 1)),
        "Program Closes": str(closes),
        "Closing Rate (%)": "{:.2f}%".format(100.0 * closes / max(attendees, 1)),
        "Ticket Sales": money(buyers_total * 29.0),
        "Total Cash": money(cash),
        "AOV (Cash)": money(cash / max(closes, 1)),
        "ROAS CC": "{:.2f}".format(cash / max(spend, 1)),
        "CAC": money(spend / max(closes, 1)),
        "Notes": "",
    })

# --- Lead Magnets Tracker (quiz de reconexion, embudo aparte) -----------------
for _ in range(180):
    first, last = random.choice(FIRST), random.choice(LAST)
    email = "{}.{}{}@{}".format(first.lower(), last.lower(), random.randint(1, 999),
                                random.choice(DOMAINS))
    day = TODAY - dt.timedelta(days=random.randint(0, 120))
    flags = {f: ("Yes" if random.random() < p else "No") for f, p in
             [("feels_calm", .34), ("has_plan", .28), ("can_deescalate", .55),
              ("has_meaning", .30), ("open_to_strategy", .62)]}
    score = sum(1 for v in flags.values() if v == "Yes")
    leads.append({
        "Submitted At": "{:02d}/{:02d}/{}".format(day.month, day.day, day.year),
        "Full Name": "{} {}".format(first, last), "Email": email,
        "Phone": "1{}{}".format(random.randint(200, 989), random.randint(2000000, 9999999))
        if random.random() < 0.6 else "",
        "Score": str(score), "Score Max": "5",
        "Persona": "ready" if score >= 4 else "heal",
        "persona Label": "Ready to Reunite (4-5)" if score >= 4 else "Heal First (0-3)",
        "Recommended Step": "Invite to live event / REVIVE" if score >= 4
        else "Heal first, then strategy (3-month method)",
        "Court Context": random.choice(["TRUE", "FALSE"]),
        "Knows Ginger": "TRUE" if random.random() < 0.71 else "FALSE",
        "biggest_barrier": pick(BARRIERS, [.52, .28, .20]),
        "time_estranged": pick(TIME_EST, [.24, .34, .42]),
        "already_tried": ", ".join(random.sample(TRIED, random.randint(1, 3))),
        "outreach_result": pick(OUTREACH, [.55, .31, .14]),
        "looking_for": pick(LOOKING, [.22, .38, .19, .21]),
        "knows_ginger_via": pick(CHANNELS, [.24, .14, .18, .12, .11, .07, .08, .06]),
        **flags,
    })

payload = {
    "ok": True, "demo": True,
    "spreadsheet": "RPA - Tracking Sheet (DEMO)",
    "updatedAt": dt.datetime(2026, 8, 25, 18, 30).isoformat() + "Z",
    "timezone": "America/New_York",
    "tabs": {
        "Ticket Buyers - UTM Tracking Sheet": tickets,
        "Webinar Ticket Purchase Quiz Responses": quizzes,
        "Program Buyers": program,
        "Event Tracker": events,
        "Lead Magnets Tracker": leads,
    },
}
payload["meta"] = [{"tab": k, "rows": len(v)} for k, v in payload["tabs"].items()]

out = __file__.rsplit("/", 1)[0] + "/demo.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)
print("escrito", out)
for m in payload["meta"]:
    print("  {}: {}".format(m["tab"], m["rows"]))
