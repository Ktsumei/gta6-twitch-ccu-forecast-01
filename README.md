[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Ktsumei/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Ktsumei/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

# GTA VI launch-day Twitch forecast

A ratio-curve forecaster for make.fun's `gta6-twitch-ccu-forecast-01`: it
forecasts hourly concurrent viewers in the Grand Theft Auto VI Twitch
category for hours 2–24 of release day (2026-11-19 UTC), as five quantiles
per hour.

## Method

Every comparable launch in the case file contributes its release-day hourly
curve, normalised by its own hour-1 print (`r_h = v_h / v_1`). The forecast
for hour `h` is anchored on the case's own hour-1 print, so the scale of GTA
VI itself comes from the live first hour. Per hour, the centre is the
weighted median of `log r_h` across donors (comparable 1.0,
early-access-contaminated 0.35, weak 0.2; the GTA VI pre-release category
history is not a launch day and is excluded), and the spread is the weighted
interquartile range turned into a lognormal sd, capped at 0.75. A 15%
log-space blend toward the house baseline and a 3-point moving average
smooth the result. Hours with fewer than 5 donors fall back to the house
baseline.

Tuned by leave-one-out cross-validation on the kit's 38 comparable launches
(mean pinball loss on the log scale): baseline 0.930, this model 0.806; on
the 9 console-first rolling-midnight launches most like GTA VI: baseline
0.393, this model 0.291.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) reads every `*.in` case in the
input directory and writes one `<id>.out` per case: 23 rows, hours 2–24,
each five quantiles. Deterministic, no network, runs in well under a second
per case.

Entered on make.fun
