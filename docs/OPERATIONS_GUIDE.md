> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# Operations Guide — Staff, Riders and Super Admin

Status: v1.0 — 2026-10-21. For day-to-day use of the admin site (`admin.<domain>`) and the rider screen (`admin.<domain>/rider`). Button names are written exactly as they appear on screen (Bangla). Train every staff member on their own section before launch (IMPLEMENTATION_PLAN §6).

Security rules for everyone:

- Use only your own account. Never share passwords, authenticator codes or recovery codes.
- Managers and the Super Admin must use an authenticator app (Google Authenticator, Microsoft Authenticator or Authy). Keep the 10 recovery codes on paper in a safe place.
- After 5 wrong passwords the account locks for 15 minutes. Forgotten password: your manager (for staff and riders) or the Super Admin (for managers) sets a temporary one with **পাসওয়ার্ড রিসেট** in **আউটলেট ও স্টাফ → স্টাফ**. Lost phone with the authenticator: the Super Admin presses **২-ধাপ রিসেট**; you set it up again at the next login.
- Change your own password any time with **পাসওয়ার্ড** in the top bar.
- Idle sessions end automatically (staff after 30 minutes, riders after 2 hours). Log out on shared devices.

---

## 1. First login (all staff)

1. Open the admin site and enter the email or mobile number and the temporary password you were given.
2. Managers and Super Admin only: the screen shows a QR code. Scan it with the authenticator app, type the 6-digit code and press **চালু করুন**.
3. Write down the 10 recovery codes and press **সংরক্ষণ করেছি — চালিয়ে যান**. Each code works once, if your phone is lost.
4. On later logins, enter the 6-digit code from the app after your password.

## 2. Outlet staff and manager — daily order work

The top bar always shows your outlet (badge **সক্রিয় আউটলেট**). You only ever see your own outlet's orders, stock and riders.

### 2.1 Incoming orders (**অর্ডার**)

| Order status (screen) | What to do | Button |
|---|---|---|
| New order (PLACED) | Check items and slot. Confirm, or reject with a reason (e.g. item damaged). | **নিশ্চিত করুন** / **প্রত্যাখ্যান** |
| Confirmed | Start packing near the slot time. Use **পিক লিস্ট** for the whole slot. | **প্রস্তুত শুরু** |
| Preparing | Packed and labelled with the order number. | **প্রস্তুত — পাঠানো যাবে** |
| Ready | Choose the rider in **রাইডার**, then press **রাইডার নির্ধারণ**. Hand over the bag. | **রাইডারের হাতে দিন** |

- Stock is reserved when the customer orders and is taken out of stock when you press **রাইডারের হাতে দিন**.
- Rejecting or cancelling releases the stock and the delivery slot automatically. Paid online orders get a refund request for the Super Admin.
- An order shown as late (past its slot) needs action: reschedule it to a new slot from the order page, or call the customer.
- Search by order number or customer mobile in **অর্ডার নম্বর বা মোবাইল**.

### 2.2 Failed deliveries

When a rider reports **ডেলিভারি করা যায়নি**, the goods come back to the outlet and stay reserved. On the order page the manager either:

- reschedules into a new slot (the customer gets the new time), or
- closes the order and chooses **restock** (goods are fine, back on sale) or **write-off** (spoiled), with a reason.

### 2.3 Cash on delivery (**ক্যাশ (COD) জমা**) — manager

At the end of each shift, count each rider's cash against the list. For every order press **ক্যাশ পেয়েছি** only after the cash is in your hand. The order then becomes paid.

- You cannot confirm cash you collected yourself (separation of duties).
- If the amount does not match, the order shows a discrepancy. Only the Super Admin can resolve it.

## 3. Stock

### 3.1 Receiving and adjusting (**স্টক**)

- **Receive** new stock with quantity and a note (supplier, batch).
- **Adjust** (+/−) needs a written reason. **Write-off** is for damaged or expired goods (manager).
- **Online buffer** keeps some units off the website for walk-in showroom customers. Set it per product.
- **Low-stock threshold** marks products that need re-ordering.
- Every change is recorded with your name and time in the movement history and the audit log.

### 3.2 Stock count (**স্টক গণনা**)

1. Press **নতুন গণনা শুরু**. The system saves the current stock of every product.
2. Count the shelves and type each counted number. Leave a product blank if you did not count it.
3. Press **সংরক্ষণ** as you go.
4. The manager presses **সম্পন্ন করুন**. Differences become stock adjustments. Sales made during the count are kept.

### 3.3 Transfers between outlets (**স্টক ট্রান্সফার**) — only if the business turns transfers on

1. A manager creates **নতুন অনুরোধ** (from outlet, to outlet, products, quantities).
2. The Super Admin presses **অনুমোদন**.
3. The sending outlet packs the goods and presses **পাঠানো হলো** (stock leaves the sender now).
4. The receiving outlet counts what arrived and presses **গ্রহণ করুন**. Any shortfall is recorded.

## 4. Delivery set-up — manager

- **খোলার সময় ও ছুটি**: weekly opening hours (delivery slots are only created inside them) and closure days. A closure day stops new bookings; orders already booked for that day are listed so you can reschedule them. Nothing is cancelled automatically.
- **ডেলিভারি ও স্লট**: slot times, capacity and cut-off for your outlet. You cannot lower a slot's capacity below orders already booked.

## 5. Riders (**আজকের ডেলিভারি**, on the phone)

1. Log in on your phone. You see only deliveries assigned to you, in slot order.
2. Each card shows the items, the customer's name, **কল করুন**, **ম্যাপে দেখুন**, and either **ক্যাশ নিতে হবে: ৳…** or **অনলাইনে পরিশোধিত — টাকা নেবেন না**.
3. Press **পৌঁছেছি** at the address.
4. Delivered: press **ডেলিভারি সম্পন্ন**. For cash orders, enter **কত টাকা নিয়েছেন (৳)**. If the amount is different, write why. Press **নিশ্চিত করুন**.
5. Not delivered: press **ডেলিভারি করা যায়নি**, choose the reason (**গ্রাহক পাওয়া যায়নি / ফোন ধরেননি**, **ভুল ঠিকানা**, **গ্রাহক নেননি**, **অন্যান্য**) and return the goods to the outlet.
6. No network: updates are saved on the phone and sent automatically when the network returns.
7. Hand all collected cash to the manager at the end of the shift.

Customer phone numbers disappear from your screen 2 hours after a delivery is closed. Do not save customer numbers on your personal phone.

## 6. Super Admin

| Area | Screen | Notes |
|---|---|---|
| Outlets and staff | **আউটলেট ও স্টাফ** | New outlets start paused and not taking orders. Create managers here; deactivating a person ends their sessions immediately. |
| Products and prices | **পণ্য ও দাম** | Products stay drafts until **publish**. Editing published content returns it to draft until re-published. Price changes apply to new orders only and are audited. |
| Delivery areas | **ডেলিভারি ও স্লট** | Areas → zones → per-outlet rules (fee, free-delivery threshold, minimum order, COD on/off and limit, priority). Only configured areas can order. |
| Banners and pages | **ব্যানার ও পেজ** | Only approved banners and published pages appear. Upload real photos only. |
| Coupons | **কুপন** | Percent, fixed or free delivery, with usage limits. |
| Payments | **পেমেন্ট ও রিফান্ড** | Reconciliation exceptions, manual re-verify, refunds (see PAYMENT_GATEWAY_GUIDE.md). |
| Reports | **রিপোর্ট** | Sales, inventory, delivery and COD, per outlet or all outlets; CSV export is audited. |
| Audit | **অডিট লগ** | Who did what, when. |
| Settings | **সেটিংস** | Online payment on/off, SMS events, transfers, maintenance mode, limits. |
| Privacy | **গ্রাহক তথ্য মুছা** | Account deletion requests. Completing removes name, phone and addresses permanently; order amounts stay for accounting. Finish open orders first. |

### 6.1 Incidents

- Payment gateway problem: **সেটিংস → payments.online.enabled = false**. Customers can still order with cash on delivery where allowed.
- Any serious problem (wrong prices, outage, data issue): **সেটিংস → storefront.maintenance = true**. Customers can browse; ordering and paying pause and a notice is shown. Turn it off when fixed.
- Lost authenticator: the Super Admin presses **২-ধাপ রিসেট** for that person in **আউটলেট ও স্টাফ → স্টাফ**; they enrol again at next login. All their sessions end.
- Suspected account misuse: deactivate the person (sessions end at once), then review **অডিট লগ**.

## 7. Customer support answers

- "I paid but the order says unpaid": check **পেমেন্ট ও রিফান্ড**. Online payments become paid only after the gateway confirms; this usually takes seconds and the system re-checks automatically every few minutes. Never mark an order paid by hand.
- "Cancel my order": customers can cancel themselves until the order is confirmed (setting). After that, staff cancel from the order page with a reason.
- "Delete my account": customers request it from **আমার অ্যাকাউন্ট → গোপনীয়তা**. The Super Admin completes it.
