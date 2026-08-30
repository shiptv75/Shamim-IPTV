# Visitor Counter — Cloudflare Worker সেটআপ (একবারই করতে হবে)

এটা `admin-config.json` এর মতো না — এটা একটা ছোট **আলাদা প্রজেক্ট**, যেটা Cloudflare-এ একবার বসিয়ে দিলে সবসময় চলতে থাকবে। মূল সাইটের deploy-এর সাথে এর কোনো সম্পর্ক নেই।

## ধাপ ১ — KV Namespace বানানো (এখানেই সংখ্যাটা জমা থাকবে)
1. dash.cloudflare.com → বাম মেনুতে **Storage & Databases > KV**
2. **Create a namespace** চাপো, নাম দাও `visitor-counter-kv`
3. **Create** চাপো

## ধাপ ২ — Worker বানানো
1. **Workers & Pages > Create > Workers > Create Worker**
2. নাম দাও (যেমন `shamim-visitor-counter`), **Deploy** চাপো (ডিফল্ট "Hello World" কোড দিয়েই প্রথমে deploy হবে)
3. Deploy হওয়ার পর **Edit code** এ যাও
4. এই ফোল্ডারের `worker.js` ফাইলের পুরো কোডটা কপি করে, Worker-এর এডিটরে থাকা সব কোড মুছে পেস্ট করে দাও
5. **Deploy** চাপো আবার

## ধাপ ৩ — KV কে Worker-এর সাথে Bind করা
1. তোমার Worker-এর পেজে যাও → **Settings > Variables and Secrets** (বা **Bindings**)
2. **Add binding > KV Namespace**
3. Variable name-এ লিখবে ঠিক এভাবে: **`VISITORS`** (বড় হাতের অক্ষরে, exact এই নামেই — কোডের সাথে মিলতে হবে)
4. KV namespace থেকে **visitor-counter-kv** সিলেক্ট করো
5. **Save and deploy**

## ধাপ ৪ — Worker-এর URL কপি করা
Worker-এর Overview পেজে একটা URL দেখবে, এরকম:
```
https://shamim-visitor-counter.<তোমার-subdomain>.workers.dev
```
এই পুরো URL-টা কপি করে রাখো।

## ধাপ ৫ — সাইটের কোডে বসানো
`js/app.js` ফাইলে এই লাইনটা খুঁজে বের করো:
```js
const VISITOR_COUNTER_API = ""; // e.g. "https://shamim-visitor-counter.YOUR-SUBDOMAIN.workers.dev"
```
এখানে তোমার Worker URL টা বসিয়ে দাও (শেষে কোনো `/` ছাড়া), যেমন:
```js
const VISITOR_COUNTER_API = "https://shamim-visitor-counter.abc123.workers.dev";
```
তারপর GitHub-এ `app.js` কমিট করে দাও — Pages auto-deploy হয়ে যাবে।

## এটা কীভাবে গুনবে
প্রতিটা ব্রাউজার-সেশনে (একই ট্যাবে বারবার রিফ্রেশ করলে) মাত্র **একবার** গণনা হবে — নতুন ট্যাব/ডিভাইস/ভিজিটর আসলে সংখ্যাটা বাড়বে। এটা "মোট ভিজিট" সংখ্যা দেখায়, রিয়েল-টাইমে আপডেট হয়, এবং exact/accurate কারণ এটা Cloudflare-এর নিজস্ব storage (KV) ব্যবহার করে, কোনো অনুমান/estimate না।
