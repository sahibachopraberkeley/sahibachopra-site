# Visitor analytics

Private, first-party measurement for sahibachopra.com. Answers four questions:
how many people visit each day, what time they come, where they are, and which
part of the page actually holds them.

Nothing here is shared with a third party. There is no Google, no Plausible, no
ad network. The data sits in your own AWS account and the only way to read it is
from this machine with your own credentials.

## Seeing the numbers

```bash
cd ~/sahibachopra-site/analytics
node report.mjs                  # last 30 days, printed in the terminal
node report.mjs --days 90        # a longer window
node report.mjs --html           # also opens a visual report in the browser
node report.mjs --day 2026-09-01 # one day in detail
```

`--html` writes `analytics/report.html`. That file holds real visitor data and is
gitignored on purpose. Do not commit it: this repo is served publicly.

## What is stored, and what is not

Stored per visit: timestamp, the visitor's own local time and timezone, city /
region / country, referrer, device, browser, OS, screen size, language, whether
they had been before, scroll depth, and milliseconds of attention per section.

Never stored: IP addresses, names, emails, anything identifying a person.
Location comes from CloudFront resolving it at the edge, so the raw IP is never
passed on to the collector and never written down. No cookies are set. The only
browser storage is a session id that dies with the tab and a one-bit "seen
before" flag.

Rows delete themselves after three years via DynamoDB TTL (`RetentionDays` in
`template.yaml`).

Visitors sending Do Not Track are not recorded at all. To count everyone
instead, set `HONOR_DNT = false` near the top of `../analytics.js`.

## How the section timing works

Once a second, whichever block fills most of the viewport is credited with that
second. The clock stops while the tab is hidden and after two minutes of
silence, so a page left open over lunch does not report an hour of attention on
Research. Only sections covering more than 15% of the screen can win, so a
sliver of the next section scrolling into view does not steal credit.

Because of the idle rule, reported time is *active reading time*, which is
lower and more honest than the "time on page" most analytics tools print.

## Architecture

```
browser (analytics.js)
   |  sendBeacon, text/plain, no preflight
   v
CloudFront  ......... adds CloudFront-Viewer-City / -Country-Region-Name / -Country
   |                  (the only reason this distribution exists)
   v
API Gateway (HTTP API)
   |
   v
Lambda (src/collect.mjs)  ... validates origin, drops bots, writes
   |
   v
DynamoDB  SahibaSiteAnalytics
   PK day  = YYYY-MM-DD of the session start
   SK      = "view#<ts>#<sid>"  one row per page load
             "eng#<sid>"        one row per session, rewritten on each flush
                                so a long visit cannot double count
```

The engagement beacon is resent every 60 seconds and again on exit. Because the
row is keyed on the session id alone, the rewrites overwrite rather than
accumulate.

## Redeploying

```bash
cd ~/sahibachopra-site/analytics
sam deploy --stack-name sahiba-site-analytics --region us-east-1 \
  --resolve-s3 --capabilities CAPABILITY_IAM --no-confirm-changeset
```

Stack `sahiba-site-analytics` in `us-east-1`, AWS account 123606513724, deployed
by IAM user `code-detection-deploy` (which needed `CloudFrontFullAccess` added on
top of what the PDW stack used).

Changing the CloudFront distribution takes a few minutes to propagate. Changing
only the Lambda is nearly instant.

If you change the endpoint, update `ENDPOINT` at the top of `../analytics.js`
and bump the `?v=` cache stamp on the script tag in `index.html`, the same way
the site does for `styles.css` and `script.js`.

## Cost

Effectively nothing at this traffic level. CloudFront's always-free tier covers
1TB out and 10M requests a month, Lambda's covers 1M requests, and each beacon
is a fraction of a kilobyte. DynamoDB on-demand writes run about $1.25 per
million; a few thousand visits a month is well under a cent. Expect a bill of
$0.00 to a few cents.

## Adding a section

Section names come from the DOM, so nothing needs updating. Any
`<section class="sec">` with a `.bar__t` heading is tracked automatically under
that heading's text. Expandable papers under `#research` are tracked by their
`<summary>` text.
