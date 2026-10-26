#!/usr/bin/env python3
"""
Publication-quality graphs for the experiment report (specification §8, §12).

    python loadtest/report/make-graphs.py

Reads  loadtest/results/exp/aggregate.json   (written by report/stats.mjs)
and    loadtest/results/exp/*.resources.csv  (written by run-experiments.sh)
Writes loadtest/results/exp/graphs/*.png

Every number comes from those files. A figure whose data is absent is skipped
with a printed reason rather than drawn from placeholder values — a paper must
not contain a graph that is not backed by a run.

The ten figures cover the ten dashboard panels the specification asks for:
  1 latency vs concurrent users      6 gas consumption by operation
  2 throughput vs concurrent users   7 transaction confirmation time
  3 error and success rate           8 CPU utilisation
  4 block-inclusion outcome mix      9 memory utilisation
  5 staking/challenge cost          10 baseline vs proposed comparison
plus the stress and spike timelines, which are what §13/§14 actually need.
"""
import csv
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
EXP = os.path.join(HERE, "..", "results", "exp")
GRAPHS = os.path.join(EXP, "graphs")

plt.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 150,
    "font.size": 10,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "figure.autolayout": True,
})

COL = {
    "proposed": "#1f6feb",
    "avg": "#1f6feb",
    "p95": "#d29922",
    "p99": "#cf222e",
    "ok": "#1a7f37",
    "bad": "#cf222e",
    "baseline": "#8250df",
    "alt": "#0d9488",
}


def load_aggregate():
    path = os.path.join(EXP, "aggregate.json")
    if not os.path.exists(path):
        sys.exit(f"missing {path} — run loadtest/report/stats.mjs first")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def metric(group, name):
    """(mean, stdev) for a metric of a group, or (None, None)."""
    m = (group or {}).get("metrics", {}).get(name)
    if not m:
        return None, None
    return m.get("mean"), m.get("stdev")


def sweep_levels(groups):
    """[(vus, group)] sorted by concurrent users."""
    out = []
    for key, g in groups.items():
        if key.startswith("sweep@"):
            out.append((int(key.split("@")[1]), g))
    return sorted(out)


def errorbar(ax, xs, ys, errs, label, color, marker="o"):
    if not xs:
        return
    ax.errorbar(xs, ys, yerr=errs if any(e for e in errs) else None,
                label=label, color=color, marker=marker, capsize=3, linewidth=1.8)


def save(fig, name):
    os.makedirs(GRAPHS, exist_ok=True)
    path = os.path.join(GRAPHS, name)
    fig.savefig(path)
    plt.close(fig)
    print(f"  wrote {os.path.relpath(path, os.path.dirname(EXP))}")


def series(groups, mid):
    xs, ys, es = [], [], []
    for vus, g in sweep_levels(groups):
        mean, sd = metric(g, mid)
        if mean is None:
            continue
        xs.append(vus)
        ys.append(mean)
        es.append(sd or 0)
    return xs, ys, es


def series_healthy(groups, mid, floor=90.0):
    """Latency series, omitting levels where requests mostly failed.

    Once the success rate collapses, k6's percentiles are dominated by requests
    that failed immediately; plotting them would draw a latency *improvement* at
    the exact level where the system stopped serving.
    """
    xs, ys, es = [], [], []
    for vus, g in sweep_levels(groups):
        mean, sd = metric(g, mid)
        ok, _ = metric(g, "success_rate_pct")
        if mean is None or ok is None or ok < floor:
            continue
        xs.append(vus)
        ys.append(mean)
        es.append(sd or 0)
    return xs, ys, es


# ---------------------------------------------------------------- figures ---
def fig01_latency(groups):
    xs, avg, avg_e = series_healthy(groups, "lat_avg_ms")
    _, p95, p95_e = series_healthy(groups, "lat_p95_ms")
    _, p99, p99_e = series_healthy(groups, "lat_p99_ms")
    if not xs:
        return skip("fig01", "no sweep groups")
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    errorbar(ax, xs, avg, avg_e, "average", COL["avg"])
    errorbar(ax, xs, p95, p95_e, "p95", COL["p95"], "s")
    errorbar(ax, xs, p99, p99_e, "p99", COL["p99"], "^")
    ax.set_xlabel("concurrent virtual users")
    ax.set_ylabel("request latency (ms)")
    ax.set_title("Latency vs concurrent users (measurement window)")
    ax.text(0.02, 0.98, "levels with <90% success omitted",
            transform=ax.transAxes, va="top", fontsize=7, color="#6b7280")
    ax.set_xscale("log")
    ax.set_xticks(xs)
    ax.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    ax.legend()
    save(fig, "fig01_latency_vs_users.png")


def fig02_throughput(groups):
    # Successful throughput, not raw throughput: rejected requests are still
    # requests, and a node that fails fast would otherwise look fastest.
    xs, tp, tp_e = series(groups, "success_rps")
    if not xs:
        return skip("fig02", "no sweep groups")
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    errorbar(ax, xs, tp, tp_e, "successful requests", COL["proposed"])
    ax.set_ylim(0, max(tp) * 1.15)
    # No "ideal linear scaling" line here: it would run to ~18,500 req/s at the
    # last level and flatten the measured curve into the axis. The point of the
    # figure is that throughput *falls* as users are added.
    ax.set_xlabel("concurrent virtual users")
    ax.set_ylabel("requests per second")
    ax.set_title("Successful throughput vs concurrent users")
    ax.set_xscale("log")
    ax.set_xticks(xs)
    ax.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    ax.legend()
    save(fig, "fig02_throughput_vs_users.png")


def fig03_rates(groups):
    xs, err, err_e = series(groups, "error_rate_pct")
    _, ok, ok_e = series(groups, "success_rate_pct")
    if not xs:
        return skip("fig03", "no sweep groups")
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    errorbar(ax, xs, ok, ok_e, "success rate", COL["ok"])
    errorbar(ax, xs, err, err_e, "error rate", COL["bad"], "s")
    ax.set_xlabel("concurrent virtual users")
    ax.set_ylabel("percent of requests")
    ax.set_title("Success and error rate vs concurrent users")
    ax.set_xscale("log")
    ax.set_xticks(xs)
    ax.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    ax.set_ylim(-2, 102)
    ax.legend()
    save(fig, "fig03_success_error_vs_users.png")


def fig04_outcomes(groups):
    levels = sweep_levels(groups)
    if not levels:
        return skip("fig04", "no sweep groups")
    xs, ok, rev, failed = [], [], [], []
    for vus, g in levels:
        xs.append(vus)
        ok.append(metric(g, "mined_ok_total")[0] or 0)
        rev.append(metric(g, "mined_revert_total")[0] or 0)
        failed.append((metric(g, "send_fail_total")[0] or 0) + (metric(g, "no_receipt_total")[0] or 0))
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    width = 0.35
    idx = range(len(xs))
    ax.bar([i - width / 2 for i in idx], ok, width, label="mined, status 1", color=COL["ok"])
    ax.bar([i + width / 2 for i in idx], rev, width, label="mined but reverted", color=COL["bad"])
    ax.bar([i + width / 2 for i in idx], failed, width, bottom=rev,
           label="rejected / no receipt", color="#f59e0b")
    ax.set_xticks(list(idx))
    ax.set_xticklabels([str(x) for x in xs])
    ax.set_xlabel("concurrent virtual users")
    ax.set_ylabel("transactions")
    ax.set_title("Transaction outcome mix per workload level")
    ax.legend()
    save(fig, "fig04_block_inclusion_outcomes.png")


def fig05_gas(groups):
    """Gas per operation, taken from the highest workload level that has data."""
    levels = sweep_levels(groups)
    if not levels:
        return skip("fig05", "no sweep groups")
    label, g = levels[-1]
    ops = [
        ("gas_mint_avg", "mintBatch"),
        ("gas_buy_avg", "buyTokens"),
        ("gas_approve_avg", "approve"),
        ("gas_retire_avg", "retireAndCertify"),
    ]
    names, vals = [], []
    for key, nice in ops:
        mean, _ = metric(g, key)
        if mean:
            names.append(nice)
            vals.append(mean)
    # staking operations come from the staking scenarios, not the sweep
    for key, nice in [("gas_stake_avg", "depositStake"), ("gas_challenge_avg", "createChallenge"),
                      ("gas_propose_avg", "proposeResolution"), ("gas_msig_avg", "approveResolution")]:
        for k2, gg in groups.items():
            if k2.startswith("staking"):
                mean, _ = metric(gg, key)
                if mean:
                    names.append(nice)
                    vals.append(mean)
                    break
    if not names:
        return skip("fig05", "no gas measurements")
    fig, ax = plt.subplots(figsize=(6.8, 4.2))
    colors = [COL["proposed"]] * 4 + [COL["baseline"]] * len(names)
    ax.barh(names[::-1], vals[::-1], color=colors[::-1])
    for i, v in enumerate(vals[::-1]):
        ax.text(v, i, f"  {v:,.0f}", va="center", fontsize=8)
    ax.set_xlabel("gas used (mean)")
    ax.set_title(f"Gas per operation (solid = credits, purple = staking/challenge)")
    save(fig, "fig05_gas_by_operation.png")


def fig06_confirmation(groups):
    xs, avg, avg_e = series(groups, "confirm_ms_avg")
    _, p95, p95_e = series(groups, "confirm_ms_p95")
    if not xs:
        return skip("fig06", "no confirmation-time samples")
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    errorbar(ax, xs, avg, avg_e, "average", COL["avg"])
    errorbar(ax, xs, p95, p95_e, "p95", COL["p95"], "s")
    ax.set_xlabel("concurrent virtual users")
    ax.set_ylabel("receipt round trip (ms)")
    ax.set_title("Transaction confirmation time\n(Hardhat automine: no mempool wait)")
    ax.set_xscale("log")
    ax.set_xticks(xs)
    ax.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    ax.legend()
    save(fig, "fig06_confirmation_time.png")


def fig07_resources(groups):
    xs, cpu, cpu_e = series(groups, "node_cpu_pct_avg")
    _, rss, rss_e = series(groups, "node_rss_mb_max")
    if not xs:
        return skip("fig07", "no resource samples")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.6, 3.8))
    errorbar(ax1, xs, cpu, cpu_e, "node CPU", COL["proposed"])
    ax1.set_xlabel("concurrent virtual users")
    ax1.set_ylabel("CPU utilisation (%)")
    ax1.set_title("Blockchain node CPU")
    ax1.set_xscale("log")
    ax1.set_xticks(xs)
    ax1.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    errorbar(ax2, xs, rss, rss_e, "node RSS", COL["alt"])
    ax2.set_xlabel("concurrent virtual users")
    ax2.set_ylabel("resident set size (MB)")
    ax2.set_title("Blockchain node memory")
    ax2.set_xscale("log")
    ax2.set_xticks(xs)
    ax2.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    save(fig, "fig07_cpu_memory_vs_users.png")


def read_csv_rows(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def fig_timeline(name, title, outfile):
    """CPU + memory over time for a stress/spike run, from its resource CSV."""
    matches = sorted(
        f for f in os.listdir(EXP) if f.startswith(name) and f.endswith(".resources.csv")
    )
    if not matches:
        return skip(outfile, f"no {name}* resources csv")
    rows = [r for r in read_csv_rows(os.path.join(EXP, matches[0]))
            if r.get("node_rss_mb") or r.get("sys_cpu_pct")]
    if len(rows) < 3:
        return skip(outfile, f"{matches[0]} has too few samples")
    t0 = float(rows[0]["epoch_ms"])
    t = [(float(r["epoch_ms"]) - t0) / 1000 for r in rows]

    def col(name_):
        out = []
        for r in rows:
            try:
                out.append(float(r[name_]))
            except (TypeError, ValueError):
                out.append(float("nan"))
        return out

    fig, ax1 = plt.subplots(figsize=(7.4, 4.0))
    ax1.plot(t, col("sys_cpu_pct"), color=COL["p95"], linewidth=1.6, label="system CPU")
    ax1.plot(t, col("node_cpu_pct"), color=COL["bad"], linewidth=1.6, label="node CPU")
    ax1.set_xlabel("seconds into run")
    ax1.set_ylabel("CPU (%)")
    ax1.set_title(f"{title}  ({matches[0]})")
    ax2 = ax1.twinx()
    ax2.plot(t, col("node_rss_mb"), color=COL["proposed"], linewidth=1.6, linestyle="--", label="node RSS")
    ax2.set_ylabel("node RSS (MB)")
    ax2.grid(False)
    lines = ax1.get_lines() + ax2.get_lines()
    ax1.legend(lines, [ln.get_label() for ln in lines], loc="upper right", fontsize=8)
    save(fig, outfile)


def fig10_baseline(groups):
    arms = [(k, g) for k, g in groups.items() if k.startswith("baseline:")]
    if not arms:
        return skip("fig10", "no baseline arms")
    order = {"baseline:baseline": "baseline\n(no stake, no challenge)",
             "baseline:nostake": "proposed contracts\n(staking off)",
             "baseline:stake": "proposed\n(staked)"}
    arms.sort(key=lambda kv: list(order).index(kv[0]) if kv[0] in order else 99)
    labels, avg, p95, ok, tp = [], [], [], [], []
    for key, g in arms:
        labels.append(order.get(key, key))
        avg.append(metric(g, "lat_avg_ms")[0] or 0)
        p95.append(metric(g, "lat_p95_ms")[0] or 0)
        ok.append(metric(g, "success_rate_pct")[0] or 0)
        tp.append(metric(g, "throughput_rps")[0] or 0)
    fig, axes = plt.subplots(1, 3, figsize=(11.5, 3.9))
    x = range(len(labels))
    w = 0.38
    axes[0].bar([i - w / 2 for i in x], avg, w, label="average", color=COL["avg"])
    axes[0].bar([i + w / 2 for i in x], p95, w, label="p95", color=COL["p95"])
    axes[0].set_title("Verification-path latency")
    axes[0].set_ylabel("ms")
    axes[0].legend(fontsize=8)
    axes[1].bar(x, tp, 0.55, color=COL["proposed"])
    axes[1].set_title("Throughput")
    axes[1].set_ylabel("requests/s")
    axes[2].bar(x, ok, 0.55, color=COL["ok"])
    axes[2].set_title("Success rate")
    axes[2].set_ylabel("%")
    axes[2].set_ylim(0, 105)
    for ax in axes:
        ax.set_xticks(list(x))
        ax.set_xticklabels(labels, fontsize=8)
    fig.suptitle("Baseline vs proposed system (identical workload)", fontsize=11)
    save(fig, "fig08_baseline_vs_proposed.png")


def fig09_staking(groups):
    """Staking/challenge scenarios A-D: latency and outcome."""
    keys = [f"staking:{s}" for s in "ABCD"]
    present = [(k, groups[k]) for k in keys if k in groups]
    if not present:
        return skip("fig09", "no staking scenarios")
    labels = ["A normal\nverification", "B successful\nchallenge", "C invalid\nchallenge", "D concurrent\nchallenges"]
    lat = [metric(g, "lat_avg_ms")[0] or 0 for _, g in present]
    life = []
    for _, g in present:
        v = metric(g, "challenge_lifecycle_ms_avg")[0]
        if v is None:
            v = metric(g, "stake_lifecycle_ms_avg")[0]
        life.append(v or 0)
    fig, ax = plt.subplots(figsize=(6.8, 4.0))
    x = range(len(present))
    w = 0.38
    ax.bar([i - w / 2 for i in x], lat, w, label="per-request latency", color=COL["proposed"])
    ax.bar([i + w / 2 for i in x], life, w, label="full lifecycle (client measured)", color=COL["baseline"])
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels[:len(present)], fontsize=9)
    ax.set_ylabel("ms")
    ax.set_title("Staking / challenge scenarios (§8)")
    ax.legend(fontsize=8)
    save(fig, "fig09_staking_scenarios.png")


def skip(which, why):
    print(f"  skipped {which}: {why}")


def main():
    data = load_aggregate()
    groups = data.get("groups", {})
    print(f"graphs from {len(groups)} groups -> {GRAPHS}")
    fig01_latency(groups)
    fig02_throughput(groups)
    fig03_rates(groups)
    fig04_outcomes(groups)
    fig05_gas(groups)
    fig06_confirmation(groups)
    fig07_resources(groups)
    fig10_baseline(groups)
    fig09_staking(groups)
    fig_timeline("stress", "Stress test: resource timeline (§13)", "fig10_stress_timeline.png")
    fig_timeline("spike", "Spike test: resource timeline (§14)", "fig11_spike_timeline.png")
    fig_timeline("endurance", "Endurance test: resource timeline (§15)", "fig12_endurance_timeline.png")
    print("done")


if __name__ == "__main__":
    main()
