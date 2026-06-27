# Nivra — a real-time UPI fraud risk engine (working prototype)

A product portfolio piece, not a real payments product. Nivra has two parts that share one
rule-based risk engine:

- **Pay app** — a working UPI-style payment flow. Pay a saved contact and it clears instantly.
  Pay an unfamiliar payee and the same engine pushes back, live, with a step-up check or a hold
  for review.
- **Risk console** — the fraud ops side. A synthetic dataset of ~180 transactions, modelled on
  publicly reported UPI fraud patterns, plus a threshold slider that recomputes catch rate, false
  positive rate, and precision live. Every payment you make in the Pay app also lands here.

The full write-up — problem framing, the core PM tradeoff, metrics, and an RCA scenario — is in
[`CASE_STUDY.md`](./CASE_STUDY.md).

![Pay app](./screenshots/pay-app.png)
![Risk console](./screenshots/risk-console.png)

## Try it

Open `index.html` in any browser, or run it locally:

```bash
cd nivra-pay
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step, no dependencies. Plain HTML, CSS, and JS, so it's easy to read, easy to deploy,
and easy to extend.

**On the Pay app:** pay "Mom" or "Rahul K" (saved contacts) and watch it clear instantly. Then
pay "QuickCashback Rewards" or the new unfamiliar number and watch the risk gauge push back.
Try spamming Pay a few times quickly, the velocity rule will fire.

**On the Risk console:** drag the risk threshold slider. Every KPI, the chart, the reason
breakdown, and the table recompute live, so you can see the catch-rate vs false-positive tradeoff
happen in front of you instead of reading about it.

## How the risk engine works

A simple weighted rule engine, on purpose, so every score is explainable:

| Signal | Weight |
|---|---|
| New payee, not in saved contacts | 28 |
| Payee added in the last 24h + a high amount | 24 |
| Amount well above the user's typical transaction | 22 |
| Payee name matches a known scam keyword pattern | 22 |
| Round-number payment to an unfamiliar payee | 15 |
| Multiple payments in a short window | 20 |
| Transaction at an unusual hour (12am–5am) | 12 |

Scores are capped at 100. The Pay app uses fixed thresholds (30 = step-up check, 65 = hold for
review) to demonstrate production behaviour. The Risk console exposes the threshold as a slider
so you can explore the tradeoff against the historical dataset.

The historical dataset is seeded (not random per load), and includes a few transactions the
engine is deliberately bad at catching, real fraud that scores low, and a few genuine
transactions that score high. That's not a bug. It's the honest part of the case study: no
threshold setting catches everything cleanly, and that's the whole point of the exercise.

## Deploying

### GitHub Pages

```bash
git init
git add .
git commit -m "Nivra fraud risk engine prototype"
git branch -M main
git remote add origin https://github.com/<your-username>/nivra-pay.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source → Deploy from branch → main → / (root)**.
Your live link will be `https://<your-username>.github.io/nivra-pay/`.

### Vercel

```bash
npm i -g vercel
cd nivra-pay
vercel
```

Accept the defaults, no build command or framework needed, it's static. Vercel will give you a
live URL immediately.

## A note on the data

Stats referenced in the case study (fraud volumes, RBI/NPCI figures) come from public reporting
and parliamentary disclosures, paraphrased and cited in `CASE_STUDY.md`. Every transaction inside
the app itself, names, amounts, timestamps, is synthetic. No real payment data, personal data, or
financial institution is involved anywhere in this project.
