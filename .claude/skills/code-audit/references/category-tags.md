# Category Tags Reference

## Audit Tags (validated during code audit)

| Tag | Description | OWASP 2025 / OWASP LLM 2025 |
|-----|-------------|-----------------------------|
| `[security]` | Injection, exposed secrets, missing auth, SSRF | A01, A02, A04, A07 |
| `[supply-chain]` | Hallucinated/typosquatted packages, missing lockfile hashes, untrusted transitive deps, unverified third-party scripts | A03 (2025) |
| `[prompt-injection]` | Indirect prompt injection from document content / external input reaching an LLM call | LLM01 |
| `[failing-open]` | Logic that continues in a degraded but unsafe state when an exception, lock, retry, or config check fails | A10 (2025) |
| `[memory-leak]` | Unbounded growth, unclosed resources, retained refs | - |
| `[bug]` | Logic errors, data corruption, off-by-one | - |
| `[resource-leak]` | Connections, file handles, timers not cleaned up | - |
| `[async]` | Unhandled promises, race conditions, missing error propagation | - |
| `[timeout]` | Missing timeouts, potential hangs, no circuit breaker | - |
| `[shutdown]` | Graceful shutdown issues | - |
| `[edge-case]` | Unhandled scenarios, boundary conditions | - |
| `[convention]` | CLAUDE.md violations | - |
| `[type]` | Unsafe casts, missing guards, unvalidated external data | - |
| `[dependency]` | Vulnerable or outdated packages | A06 |
| `[rate-limit]` | API quota exhaustion risks, unbounded LLM consumption | LLM10 |
| `[logging]` | Missing logs, wrong levels, log overflow, insufficient debug coverage, prompt/secret leakage in logs | LLM02 (when prompts leak) |
| `[dead-code]` | Unused functions, unreachable code | - |
| `[duplicate]` | Repeated logic | - |
| `[test]` | Useless/duplicate tests, no assertions | - |
| `[practice]` | Anti-patterns | - |

**OWASP Top 10 (2025 RC) Reference:**
- A01: Broken Access Control (auth bypass, IDOR, privilege escalation, SSRF — folded in from 2021)
- A02: Security Misconfiguration (was #5 in 2021; elevated)
- A03: **Software Supply Chain Failures** (new framing — slopsquatting, typosquatting, missing lockfile integrity, unverified transitive deps)
- A04: Cryptographic Failures (renamed from 2021 A02)
- A06: Vulnerable & Outdated Components
- A07: Identification & Authentication Failures
- A10: **Mishandling of Exceptional Conditions** (new — failing-open, swallowed errors, partial-success states left dangling)

**OWASP Top 10 for LLM Applications (2025) Reference:**
- LLM01: Prompt Injection (direct AND indirect — document/file-borne content reinterpreting downstream instructions)
- LLM02: Sensitive Information Disclosure (system prompt leakage in errors/logs/responses)
- LLM03: Supply Chain (model and dataset provenance — applies to any third-party model / fine-tune)
- LLM04: Data and Model Poisoning
- LLM05: Improper Output Handling (executing/rendering LLM output without validation)
- LLM06: Excessive Agency
- LLM07: System Prompt Leakage (closely linked to LLM02; prompt template exposed via error/debug paths)
- LLM08: Vector and Embedding Weaknesses
- LLM09: Misinformation
- LLM10: Unbounded Consumption (cost/DoS via runaway model calls; no per-request token cap, no per-minute budget, no max retries)

**CWE Top 25 (2024/2025) — high-priority weaknesses to grep for explicitly:**
- CWE-79: Cross-Site Scripting (Top 25 #1)
- CWE-787: Out-of-Bounds Write
- CWE-89: SQL Injection
- CWE-22: Path Traversal
- CWE-862: Missing Authorization
- CWE-1390: Weak Authentication / unscoped API keys (relevant: GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY)

## Non-Audit Tags (preserved without validation)

| Tag | Description |
|-----|-------------|
| `[feature]` | New functionality to add |
| `[improvement]` | Enhancement to existing functionality |
| `[enhancement]` | Similar to improvement |
| `[refactor]` | Code restructuring without behavior change |

Non-audit issues are preserved in Linear Backlog without validation.

**Note on `[docs]`/`[chore]`:** when emitted by an audit reviewer they are audit tags mapped to the Technical Debt label (table below); pre-existing Backlog issues already labeled Feature/Improvement are the ones preserved without validation.

## Linear Label Mapping

When creating Linear issues, map category tags to Linear labels:

| Category Tags | Linear Label |
|---------------|--------------|
| `[security]`, `[dependency]`, `[supply-chain]`, `[prompt-injection]` | Security |
| `[bug]`, `[async]`, `[shutdown]`, `[edge-case]`, `[type]`, `[logging]`, `[failing-open]` | Bug |
| `[memory-leak]`, `[resource-leak]`, `[timeout]`, `[rate-limit]` | Performance |
| `[convention]` | Convention |
| `[dead-code]`, `[duplicate]`, `[test]`, `[practice]`, `[docs]`, `[chore]` | Technical Debt |
| `[feature]` | Feature |
| `[improvement]`, `[enhancement]`, `[refactor]` | Improvement |

## Linear Priority Mapping

Map priority levels to Linear priority values:

| Priority Tag | Linear Priority |
|--------------|-----------------|
| `[critical]` | 1 (Urgent) |
| `[high]` | 2 (High) |
| `[medium]` | 3 (Medium) |
| `[low]` | 4 (Low) |

## SSVC Action Mapping (Stakeholder-Specific Vulnerability Categorization)

Every issue created by `code-audit` and `deep-review` includes an **Action** verb derived from SSVC. SSVC (CISA/CMU SEI) emits a decision rather than a numeric score, so planners read "what to do" rather than "how bad". The action complements — does not replace — the Linear priority.

Decide the action from three inputs:

1. **Exploitation status** — None / PoC / Active
2. **Mission impact** — Negligible / Degraded / Crippled (does it affect ADVA's ability to process invoices and matches correctly?)
3. **Technical impact** — Partial / Total

| Action | When | Linear Priority Mapping |
|--------|------|-------------------------|
| **Act** | Active exploitation OR Crippled mission impact OR security with Total technical impact | 1 (Urgent) |
| **Attend** | Real bug with Degraded mission impact, or PoC exploitation, or Total technical impact without exploitation | 2 (High) or 3 (Medium) |
| **Track** | Negligible mission impact, no exploitation, Partial technical impact (style, dead code, low-value docs) | 4 (Low) |

The lead writes `**Action:** Act` (or Attend/Track) into every issue body alongside the existing priority. See SKILL.md "Issue Description Format".
