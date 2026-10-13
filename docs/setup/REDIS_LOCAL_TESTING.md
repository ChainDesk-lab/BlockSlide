# Redis Seed Storage — Local Testing Guide

**Status:** Ready to test once `REDIS_URL` is added to `.env.local`

---

## Prerequisites

✅ `redis` package installed  
✅ Seed storage code updated to use Redis  
⏳ Waiting for: `REDIS_URL` environment variable

---

## Environment Setup

### Add REDIS_URL to `.env.local`

Your `.env.local` should look like:
```bash
# Existing vars...
NEXT_PUBLIC_CONTRACT_ADDRESS=0xD551317265B9c4D1D453d399D8b8fa0b98D8ceB6
...

# Add this:
REDIS_URL=redis://default:your_password@your_host:port
```

**Get REDIS_URL from:**
1. Go to https://vercel.com/dashboard
2. Select BlockSlide project
3. Storage tab → Redis → Show secret
4. Copy the full connection string

---

## Test 1: Basic Connectivity (Verify Redis Works)

```bash
cd frontend
npm run dev
```

In browser console (F12):
```javascript
// Check if server is responding
fetch('/api/game/seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: '0x1234567890123456789012345678901234567890',
    seedHash: '0x1234567890123456789012345678901234567890123456789012345678901234',
    seed: '0x9876543210987654321098765432109876543210987654321098765432109876'
  })
})
.then(r => r.json())
.then(d => console.log('POST response:', d))

// Expected output:
// POST response: { success: true }
```

**Check server logs:**
Look for:
```
[Seed API Redis] Connected to Redis
[Seed API POST] ✓ Seed persisted for 0x1234...
```

---

## Test 2: Full Recovery Chain (localStorage Lost)

### Setup
1. Start fresh game session:
   - Navigate to http://localhost:3000
   - Click "Play"
   - Play a few moves

2. Open browser console (F12)
3. Clear localStorage:
   ```javascript
   localStorage.clear()
   ```

### Test
1. Play more moves
2. Click "Submit Score"
3. Check console logs for recovery:
   ```
   [Seed Recovery] Seed hash mismatch! Starting recovery process...
   [Seed Recovery] localStorage: seed not found
   [Seed Recovery] IndexedDB: seed recovered
   [Seed Recovery] ✓ Seed recovered from IndexedDB (localStorage was lost)
   [Seed Recovery] SUMMARY: Recovery successful
   ```

### Expected Result
- ✅ Score submits successfully
- ✅ No error message appears

---

## Test 3: Redis Recovery (Both Client Layers Lost)

### Setup
1. Start new game session:
   - Navigate to http://localhost:3000
   - Click "Play"
   - Play a few moves
   - Check logs confirm Redis storage: `[Seed API POST] ✓ Seed persisted`

2. Clear BOTH localStorage and IndexedDB:
   ```javascript
   // In console
   localStorage.clear()
   // In DevTools: Application → Storage → IndexedDB → right-click → Delete
   ```

### Test
1. Play more moves
2. Click "Submit Score"
3. Check console logs:
   ```
   [Seed Recovery] Seed hash mismatch! Starting recovery process...
   [Seed Recovery] localStorage: seed not found
   [Seed Recovery] IndexedDB: seed not found
   [Seed Recovery] ✓ Seed recovered from server (all client storage was lost)
   [Seed Recovery] SUMMARY: Recovery successful
   ```

### Expected Result
- ✅ Score submits successfully
- ✅ Seed was recovered from Redis (the critical fix!)
- ✅ Server logs show: `[Seed API GET] ✓ Seed recovered`

---

## Test 4: Multiple Sessions (Concurrent Recovery)

### Setup
1. Open game in Tab A, play, clear storage, note address
2. Open game in Tab B (different address), play, clear storage

### Test
1. Submit score in Tab A
2. Submit score in Tab B
3. Both should recover independently from Redis

### Expected Result
- ✅ Both scores submit successfully
- ✅ No conflicts in Redis storage

---

## Troubleshooting

### Error: "Cannot find module 'redis'"
```bash
cd frontend
npm install
```

### Error: "REDIS_URL not set"
Check `.env.local` exists and has:
```
REDIS_URL=redis://...
```

### Error: "Cannot connect to Redis"
Check in Vercel dashboard:
1. Storage → Redis → Connection string visible?
2. Is Redis database active?
3. Try copying the connection string again

### Error: "Seed recovered from server" but still get "seed was lost"
1. Check server logs for: `[Seed API GET] ✗ Seed not found`
2. Verify Redis has TTL set correctly
3. Check expiration logic in `/frontend/src/hooks/useGameSession.ts`

### Server Logs Show "Client error"
```
[Seed API Redis] Client error: Connection failed
```
This means:
- REDIS_URL is invalid
- Redis service is down
- Network connection blocked

Solutions:
- Verify REDIS_URL format: `redis://default:password@host:port`
- Check Vercel dashboard → Storage → Redis → Status (should be "Connected")
- Try refreshing the database connection in Vercel

---

## Success Indicators

### Console Logs (Browser)
✅ `[Seed Recovery] ✓ Seed recovered from server`  
✅ `[Seed Recovery] SUMMARY: Recovery successful`  

### Server Logs (Next.js Dev)
✅ `[Seed API Redis] Connected to Redis`  
✅ `[Seed API POST] ✓ Seed persisted`  
✅ `[Seed API GET] ✓ Seed recovered`  

### Behavior
✅ Game sessions work normally  
✅ Clearing storage doesn't break submissions  
✅ Multiple sessions work independently  

---

## What to Report After Testing

1. **Did connectivity test work?** (Can Redis store/retrieve?)
2. **Did Test 2 pass?** (IndexedDB recovery still works?)
3. **Did Test 3 pass?** (Redis recovery works — the critical fix!)
4. **Any errors in logs?** (Paste full error message)
5. **Performance:** Did submissions feel fast or slow?

Once all 4 tests pass locally, we deploy to production.

---

## Next Steps After Local Testing

1. ✅ All tests pass locally
2. Commit code: 
   ```bash
   git add -A
   git commit -m "fix: add Redis persistence for seed backup storage"
   ```
3. Push to production:
   ```bash
   git push origin main
   ```
4. Monitor production logs for 24 hours
5. Verify "seed was lost" errors drop significantly
