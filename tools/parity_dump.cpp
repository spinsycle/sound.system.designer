// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Cross-implementation parity: evaluates the Sound System plugin's own analytic functions (its JUCE-free headers) for
// a spread of random configurations and prints one self-describing JSON object per line. The TypeScript library must
// reproduce every number (packages/physics/test/parity.test.ts). Built and run by tools/parity-dump.ps1; the output is
// committed, so the tests need no C++ toolchain.
#include "Room.h"
#include "System.h"

#include <cstdio>
#include <random>
#include <string>
#include <vector>

using namespace soundsystem;

static std::mt19937 rng (20261109);
static double uni (double lo, double hi) { return lo + (hi - lo) * (double) (rng() >> 5) / 134217728.0; }
static int pick (int n) { return (int) (rng() % (unsigned) n); }
static bool chance (double p) { return uni (0.0, 1.0) < p; }
static double logUni (double lo, double hi) { return lo * std::pow (hi / lo, uni (0.0, 1.0)); }

static std::string num (double v)
{
    char b[40];
    std::snprintf (b, sizeof b, "%.17g", v);
    return b;
}
static std::string cplx (cd v) { return "[" + num (v.real()) + "," + num (v.imag()) + "]"; }
static std::string list (const std::vector<std::string>& v)
{
    std::string s = "[";
    for (size_t i = 0; i < v.size(); ++i)
        s += (i ? "," : "") + v[i];
    return s + "]";
}
static std::string freqList (const std::vector<double>& f)
{
    std::vector<std::string> s;
    for (double x : f)
        s.push_back (num (x));
    return list (s);
}

static Params randomBox()
{
    Params p;
    p.cls = pick (11) - 1;       // -1 (treated as class 0) .. 9 (8 and 9 are Custom)
    p.type = pick (4);
    p.volumeL = chance (0.05) ? 0.0 : logUni (1.0, 800.0);
    p.tuneHz = chance (0.05) ? 0.0 : logUni (15.0, 300.0);
    p.frontVolumeL = chance (0.08) ? 0.0 : logUni (1.0, 400.0);
    p.hornThroatCm2 = chance (0.08) ? 0.1 : logUni (5.0, 2000.0);
    p.hornMouthCm2 = chance (0.1) ? p.hornThroatCm2 * 0.5 : p.hornThroatCm2 * logUni (1.5, 40.0);
    p.hornLengthM = chance (0.05) ? 0.0 : logUni (0.1, 4.0);
    const bool wild = chance (0.25); // beyond the plugin's parameter ranges, so the engine clamps are exercised
    const double k = wild ? 4.0 : 1.0;
    p.customFsHz = logUni (10.0 / k, 300.0 * k);
    p.customQts = logUni (0.15 / k, 1.5 * k);
    p.customQms = logUni (1.0 / k, 20.0 * k);
    p.customVasL = logUni (1.0 / (k * k * k), 2000.0 * k);
    p.customSdCm2 = logUni (5.0 / (k * k), 2500.0 * k);
    p.customReOhm = logUni (1.0 / k, 32.0 * k);
    p.customXmaxMm = logUni (0.2 / k, 40.0 * k);
    p.customPowerW = logUni (5.0 / (k * k), 5000.0 * k);
    return p;
}

static std::string boxJson (const Params& p)
{
    return "{\"cls\":" + std::to_string (p.cls) + ",\"type\":" + std::to_string (p.type) + ",\"volumeL\":" + num (p.volumeL) + ",\"tuneHz\":" + num (p.tuneHz)
           + ",\"frontVolumeL\":" + num (p.frontVolumeL) + ",\"hornThroatCm2\":" + num (p.hornThroatCm2) + ",\"hornMouthCm2\":" + num (p.hornMouthCm2)
           + ",\"hornLengthM\":" + num (p.hornLengthM) + ",\"custom\":{\"fsHz\":" + num (p.customFsHz) + ",\"qts\":" + num (p.customQts) + ",\"qms\":" + num (p.customQms)
           + ",\"vasL\":" + num (p.customVasL) + ",\"sdCm2\":" + num (p.customSdCm2) + ",\"reOhm\":" + num (p.customReOhm) + ",\"xmaxMm\":" + num (p.customXmaxMm)
           + ",\"powerW\":" + num (p.customPowerW) + "}}";
}

// Cone displacement per volt with the clamps designPlant applies (the plugin's lowcheck has the same helper).
static cd analyticX (const Params& p, double f)
{
    const auto d = driverFor (p);
    const auto r = deriveDriver (d);
    const double vb = std::max (p.volumeL, 0.01) / 1000.0, fb = std::max (p.tuneHz, 1.0);
    switch (p.type)
    {
        case kSealed: return sealedX (f, d, r, vb);
        case kPorted: return ventedX (f, d, r, d.vasM3 / vb, fb);
        case kBandpass: return bandpassX (f, d, r, d.vasM3 / vb, d.vasM3 / (std::max (p.frontVolumeL, 0.01) / 1000.0), fb);
        default:
        {
            const double st = std::max (p.hornThroatCm2, 0.5) * 1e-4, sm = std::max (p.hornMouthCm2, p.hornThroatCm2 * 1.01) * 1e-4;
            return hornX (f, hornModel (d, r, vb, st, sm, std::max (p.hornLengthM, 0.05)));
        }
    }
}

static std::vector<double> randomFreqs (int n, double lo, double hi)
{
    std::vector<double> f;
    for (int i = 0; i < n; ++i)
        f.push_back (logUni (lo, hi));
    return f;
}

int main()
{
    const double rates[] = { 44100.0, 48000.0, 96000.0, 192000.0 }; // at 192 kHz a 25 ms delay passes the plugin's 4095-sample cap

    for (int i = 0; i < 240; ++i)
    {
        const auto p = randomBox();
        const auto f = randomFreqs (8, 5.0, 8000.0);
        std::vector<std::string> g, x;
        for (double hz : f)
        {
            g.push_back (cplx (analyticG (p, hz)));
            x.push_back (cplx (analyticX (p, hz)));
        }
        const auto d = driverFor (p); // the resolved driver, so Xmax and Power (which no response uses) are compared too
        std::printf ("{\"kind\":\"box\",\"p\":%s,\"driver\":%s,\"f\":%s,\"g\":%s,\"x\":%s}\n", boxJson (p).c_str(),
                     freqList ({ d.fs, d.qes, d.qms, d.vasM3, d.sd, d.re, d.xmax, d.pe }).c_str(), freqList (f).c_str(), list (g).c_str(), list (x).c_str());
    }

    for (int i = 0; i < 120; ++i)
    {
        SystemParams p;
        p.bands = chance (0.05) ? pick (2) - 1 : 1 + pick (4); // mostly 1..4, sometimes 0 or -1 (silent); above 4 the plugin reads past its array
        for (auto& x : p.xover)
            x = logUni (15.0, 30000.0); // unordered and beyond the caps on purpose
        if (chance (0.5))
            p.xover = { logUni (60.0, 200.0), logUni (400.0, 1200.0), logUni (2500.0, 6000.0) };
        p.align = chance (0.5);
        std::vector<std::string> bands;
        for (auto& b : p.band)
        {
            b.box = randomBox();
            b.solo = chance (0.1);
            b.mute = chance (0.1);
            b.trimDb = uni (-24.0, 12.0);
            b.delayMs = uni (-2.0, 25.0);
            bands.push_back ("{\"box\":" + boxJson (b.box) + ",\"solo\":" + (b.solo ? "true" : "false") + ",\"mute\":" + (b.mute ? "true" : "false")
                             + ",\"trimDb\":" + num (b.trimDb) + ",\"delayMs\":" + num (b.delayMs) + "}");
        }
        const double fs = rates[pick (4)];
        const auto f = randomFreqs (8, 15.0, 0.45 * fs);
        std::vector<std::string> h;
        for (double hz : f)
            h.push_back (cplx (systemResponse (p, hz, fs)));
        std::printf ("{\"kind\":\"sys\",\"p\":{\"bands\":%d,\"xover\":%s,\"align\":%s,\"band\":%s},\"fs\":%s,\"f\":%s,\"h\":%s}\n", p.bands,
                     freqList ({ p.xover[0], p.xover[1], p.xover[2] }).c_str(), p.align ? "true" : "false", list (bands).c_str(), num (fs).c_str(),
                     freqList (f).c_str(), list (h).c_str());
    }

    for (int i = 0; i < 200; ++i)
    {
        RoomParams p;
        p.distanceM = chance (0.08) ? uni (-5.0, 1.0) : chance (0.08) ? uni (200.0, 400.0) : logUni (1.0, 200.0); // both clamps
        p.held = chance (0.3);
        p.boundary = pick (4);
        p.boundaryDistM = chance (0.1) ? 0.0 : logUni (0.1, 5.0);
        p.indoor = chance (0.5);
        p.rt60 = chance (0.1) ? 0.0 : logUni (0.2, 5.0);
        p.volumeM3 = chance (0.1) ? 0.0 : logUni (100.0, 100000.0);
        const double fs = rates[pick (4)];
        const auto f = randomFreqs (8, 15.0, 0.45 * fs);
        std::vector<std::string> h;
        for (double hz : f)
            h.push_back (cplx (roomDirectResponse (p, hz, fs)));
        std::printf ("{\"kind\":\"room\",\"p\":{\"distanceM\":%s,\"held\":%s,\"boundary\":%d,\"boundaryDistM\":%s,\"indoor\":%s,\"rt60\":%s,\"volumeM3\":%s},"
                     "\"fs\":%s,\"f\":%s,\"h\":%s,\"directGain\":%s,\"tailGain\":%s}\n",
                     num (p.distanceM).c_str(), p.held ? "true" : "false", p.boundary, num (p.boundaryDistM).c_str(), p.indoor ? "true" : "false",
                     num (p.rt60).c_str(), num (p.volumeM3).c_str(), num (fs).c_str(), freqList (f).c_str(), list (h).c_str(), num (directGain (p)).c_str(),
                     num (tailGain (p)).c_str());
    }
    return 0;
}
