# Seed Mismatch Bug Fix — Deployment Checklist

**Status:** ✅ Ready for Deployment  
**Last Updated:** 2026-08-26  

---

## Pre-Deployment Verification

### Code Changes Verified

- [x] `/frontend/app/api/game/seed/route.ts` — Server now uses file-based persistent storage (`.seeds-store.json`)
- [x] `/frontend/src/hooks/useGameSession.ts` — Client now awaits and validates server backup POST response
- [x] `/frontend/src/lib/seedStorage.ts` — IndexedDB clearing now safe (only deletes address-specific old seeds)
- [x] All files have `CRITICAL FIX (2026-08-26)` comments marking the changes
- [x] Comprehensive logging added at every recovery step

### Documentation Completed

- [x] `SEED_MISMATCH_DIAGNOSIS.md` — Root cause analysis of all three failure points
- [x] `SEED_RECOVERY_TEST.md` — Complete test procedures for all recovery layers
- [x] `SEED_FIX_SUMMARY.md` — Executive summary of the fix and expected impact
- [x] This checklist

---

## Staging Deployment

### 1. Deploy to Staging Environment

```bash
git checkout -b fix/seed-mismatch-persistent-storage
# Changes are already committed
git push -u origin fix/seed-mismatch-persistent-storage
```

### 2. Run Full Test Suite

**Required Tests (from `SEED_RECOVERY_TEST.md`):**

- [ ] **Test 1: localStorage Recovery** 
  - Clear localStorage, submit score
  - Should recover from IndexedDB ✅
  - Expected log: `[Seed Recovery] ✓ Seed recovered from IndexedDB (localStorage was lost)`

- [ ] **Test 2: Server Recovery (Same Session)**
  - Clear localStorage AND IndexedDB (without server restart)
  - Submit score
  - Should recover from server backup ✅
  - Expected log: `[Seed Recovery] ✓ Seed recovered from server (all client storage was lost)`

- [ ] **Test 3: Server Recovery After Restart (THE KEY FIX)**
  - Start session → seed stored in all three layers
  - Restart server (`npm run dev`)
  - Clear localStorage AND IndexedDB
  - Submit score
  - Should recover from `.seeds-store.json` ✅
  - **This should work now (was impossible before)**

- [ ] **Test 4: Safari Private Mode**
  - Use Safari in private mode
  - Play and submit
  - Should work (localStorage available, IndexedDB bypassed)
  - Expected log: `[Seed Recovery] ✓ Seed recovered from localStorage`

- [ ] **Test 5: Multiple Sessions**
  - Start session A → submit (clear storage)
  - Start session B → submit (clear storage)
  - Both should work independently

### 3. Server Logs Verification

Check staging server logs:

```bash
tail -f staging.log | grep "[Seed API]"
```

Expected output during and after tests:

```
[Seed API POST] ✓ Seed persisted for 0x12ab... (hash: 0x3f8c...)
[Seed API POST] ✓ Seed persisted for 0x45cd... (hash: 0xa2b3...)
[Seed API GET] ✓ Seed recovered for 0x12ab...
[Seed API GET] ✓ Seed recovered for 0x45cd...
[Seed API] Cleaned up 2 expired seed records  # After 2 hours
```

### 4. File System Verification

Check that `.seeds-store.json` is created and growing:

```bash
ls -la .seeds-store.json
cat .seeds-store.json | jq 'length'  # Should show count of stored seeds
```

Expected structure:
```json
{
  "0x12ab...3f8c...": {
    "address": "0x12ab...",
    "seedHash": "0x3f8c...",
    "seed": "0x8f2c...",
    "createdAt": 1693900000000,
    "expiresAt": 1693907200000
  },
  ...
}
```

### 5. Regression Testing

Run existing game tests to ensure no breaking changes:

- [ ] New game session starts correctly
- [ ] Scores submit correctly (normal path, no storage loss)
- [ ] Session expiration works
- [ ] Multiple sessions don't interfere
- [ ] localStorage still works when available
- [ ] IndexedDB still works when available

---

## Production Deployment

### 1. Pre-Deployment

- [ ] Ensure staging tests all pass (see above)
- [ ] Backup current production seed storage (if any exists from old system)
- [ ] Have rollback plan ready (see Rollback section below)
- [ ] Notify team: "Deploying seed recovery infrastructure fix"

### 2. Deploy to Production

```bash
# Ensure changes are committed and pushed
git log --oneline -5  # Should show CRITICAL FIX commits

# Deploy as normal (depends on your CI/CD)
# After deployment: wait 5 minutes for seeds to start persisting
```

### 3. Post-Deployment Monitoring (First 24 Hours)

**Watch these metrics:**

```bash
# Server logs — should see POST/GET activity
tail -f production.log | grep "[Seed API"

# File growth — .seeds-store.json should grow as sessions start
watch -n 60 'ls -lh .seeds-store.json'

# Error tracking — "seed was lost" errors should drop sharply
# (Check your error tracking service, e.g., Sentry)
```

**Expected Results:**
- Logs show `✓ Seed persisted` on every session start
- Logs show `✓ Seed recovered` if seeds were recovered
- No "seed was lost" errors or significant drop in frequency
- `.seeds-store.json` grows to ~5-10 MB (will stabilize as cleanup runs)

### 4. First Week Monitoring

- [ ] Daily check for "seed was lost" errors — should be ~0
- [ ] Monitor `.seeds-store.json` file size — should stabilize after cleanup
- [ ] Monitor any seed backup failures — logs should show `[Seed API POST]` 500 errors
- [ ] Verify cleanup job ran — logs should show `[Seed API] Cleaned up N expired seed records`

---

## Rollback Plan

If serious issues arise:

### Option 1: Quick Revert (Server Only)

```bash
git revert <commit-hash>  # The frontend/app/api/game/seed/route.ts changes
git push origin main
# This keeps client changes but reverts to old (broken) server
# Not ideal but faster than full rollback
```

### Option 2: Full Rollback

```bash
git reset --hard <pre-deployment-commit>
git push -f origin main
```

### Option 3: Keep Server Fix, Revert Client

```bash
git revert <client-commit-hash>  # Frontend changes
git push origin main
# Client will stop confirming backups, but file-based storage still works
# Users can still recover from server during this time
```

**Decision Tree:**
- If issue is **"server won't write to `.seeds-store.json`"** → Option 1
- If issue is **"client getting duplicate errors"** → Option 3
- If issue is **"widespread seed loss"** → Option 2

---

## Success Criteria

### The fix is working if:

1. ✅ Server backup persists across restarts
2. ✅ "Seed was lost" errors drop to near-zero
3. ✅ Server logs show consistent `[Seed API POST] ✓` on session start
4. ✅ Server logs show recovery working when client storage fails
5. ✅ `.seeds-store.json` file exists and grows over time
6. ✅ No errors in server logs related to file writing

### The fix is NOT working if:

1. ❌ "Seed was lost" errors continue at previous frequency
2. ❌ `.seeds-store.json` doesn't exist or isn't growing
3. ❌ Server logs show `[Seed API] Failed to save seeds to file`
4. ❌ File permissions errors preventing seed storage
5. ❌ Server POST response shows `success: false`

---

## Escalation Contacts

If issues arise during deployment:

- **File write issues** → Check file permissions on production host
- **Database issues** → Check disk space, filesystem health
- **Performance issues** → `.seeds-store.json` too large (but cleanup should prevent this)
- **User-reported seed loss** → Check server logs for POST/GET failures

---

## Documentation References

For implementation details and test procedures, see:
- `SEED_MISMATCH_DIAGNOSIS.md` — Why this bug was happening
- `SEED_RECOVERY_TEST.md` — How to verify each layer of the fix
- `SEED_FIX_SUMMARY.md` — What changed and why

---

## Post-Deployment Note

After successful production deployment for 24 hours, update this checklist and mark as complete. Archive the diagnosis and test documents for historical reference.
