# Online Quran Academy LMS (TalentSync Design Standard)

Production-grade Online Quran Academy Learning Management System built to strict visual and architectural standards, replicating the layout geometry, color palette, and typography of the reference SaaS dashboard.

---

## 1. Design System & Anti-AI Slop Compliance

- **No AI Slop:** No neon glows, no purple/blue gradient backgrounds, no bouncy hover scaling (`hover:scale-105`), and no spinning loaders.
- **Top Header & Hero Banner:** `#0E4D45` Deep Forest Teal.
- **Main Body Background:** `#F8F6F1` Warm Alabaster / Soft Cream.
- **Card Surface:** Pure White (`#FFFFFF`) with subtle border (`1px solid #ECEAE4`) and soft shadow (`0 4px 20px -2px rgba(14, 77, 69, 0.05)`).
- **Navigation Geometry:** Top horizontal navigation bar inside `#0E4D45` with empty `[ Logo ]` dashed placeholder box (`40px x 40px`) and pill-shaped active state (`#236058`, `rounded-full`).
- **5 Overlapping Top KPI Cards:** Sits `-mt-14` halfway over `#0E4D45` dark teal and halfway over `#F8F6F1` cream body.
- **Attendance Dot-Matrix Heatmap:** Exact 28-column dot-matrix grid matching the reference dashboard.

---

## 2. Core Functional Modules

### Module 1: Strict Student Data Privacy Lock (Admin-Only PII)
- **Admin Portal:** Full access to guardian names, phone numbers, WhatsApp direct links, email addresses, residential street addresses, and tuition financial figures.
- **Manager & Teacher Portals:** PII is strictly locked. Students are represented exclusively as `Student ID • First Name (Country)` (e.g., `QA-1042 • Ahmed (UK)`). Contact fields display `🔒 Hidden by Admin`.
- **System Reminders:** Managers can click `"Send System Reminder"` next to any student, which triggers an automated WhatsApp/Email notification via the Academy API gateway without exposing parent phone numbers.

### Module 2: Advanced Fee & Ledger System (Chronological FIFO Waterfall)
- **12-Month Grid (`Jan`–`Dec`):** Color-coded matrix:
  - `Paid (✓)`: Solid Teal (`#0E4D45`)
  - `Partial (⚡)`: Warm Amber (`#FDE68A` / `#78350F`), displaying `$Paid / $Due`
  - `Advance (ADV)`: Medium Teal (`#D1FAE5` / `#065F46`)
  - `Defaulter (DUE)`: Soft Red (`#FEE2E2` / `#991B1B`)
  - `Upcoming (-)`: Light Grey (`#F1F4F3`)
- **FIFO Waterfall Engine:**
  - Oldest unpaid or partial months are settled first in strict chronological order.
  - Excess funds roll forward into future months as `Advance Credit`.
  - Live allocation preview table updates dynamically in real-time as the user types before committing.
- **Multi-Currency:** Multi-currency support across USD (`$`), GBP (`£`), EUR (`€`), CAD (`C$`), and PKR (`Rs`).
- **Family Sibling Combined Invoicing:** Grouped by `familyId` (e.g., `FAM-102: Dr. Tariq Khan` with siblings Zaid and Sara). Single lump-sum payments cascade chronologically across siblings.

### Module 3: 4 Instant Role Portals
1. **Admin Portal:** Comprehensive KPI overview, 12-Month Matrix, Master PII Directory, Teacher Payroll accounting, and Attendance Overview.
2. **Manager Portal:** Live Classes Radar (audio/video connectivity), Substitute Teacher 2-click dispatcher, and Masked Student Roster.
3. **Teacher Portal:** Zero-typing Sabaq logger with 1-click status pills (`Present`/`Absent`/`Late`), course track dropdowns, and 1-click remark tags (`MashaAllah Good`, `Needs Revision`, `Tajweed Focus`).
4. **Student/Parent Portal:** Sibling switcher dropdown, prominent "Join Live Class" card, daily Sabaq rating tracker, and tuition ledger with printable official receipts.

---

## 3. Quick Verification & Test Scenarios

Open `index.html` in any modern web browser (Edge, Chrome, Firefox, Safari).

### Test 1: Tariq Mansoor $120 Waterfall (3-Month Defaulter)
1. In the **Admin Portal**, click the top amber button: `⚡ Test $120 Waterfall on Tariq (3-Mo Defaulter)` or open `+ Receive Fee` and click the quick scenario button `⚡ Tariq: $120 Waterfall`.
2. Notice the live chronological distribution:
   - **Aug 2026 ($50 due):** Cleared `$50` ➔ Status becomes `PAID (✓)`.
   - **Sep 2026 ($50 due):** Cleared `$50` ➔ Status becomes `PAID (✓)`.
   - **Oct 2026 ($50 due):** Allocated remaining `$20` ➔ Status becomes `PARTIAL ($20 Paid / $30 Due)`.
   - **New Overall Balance:** Updates to `-$30 Due`.
3. Click **"Confirm & Commit Payment"**: State updates immediately and generates receipt `TXN-XXXX`.

### Test 2: Tariq Mansoor $250 Advance Waterfall
1. Open `+ Receive Fee` and click `⚡ Tariq: $250 Advance Waterfall`.
2. All 3 past due months (Aug, Sep, Oct) are settled (`$150`), and the remaining `$100` rolls into **Nov ($50 ADV)** and **Dec ($50 ADV)** as Advance Paid!

### Test 3: Sibling Combined Invoicing (FAM-102)
1. In the 12-Month Fee Ledger, click the `Family Groups (Siblings)` filter tab.
2. Under `Dr. Tariq Khan Family (FAM-102)`, click `⚡ Pay Family Combined Invoice (C$90)`.
3. Observe how the single `$90` payment clears Zaid's Oct partial ($40 due) and Sara's Oct defaulter ($50 due) simultaneously!

### Test 4: Student Privacy Enforcement
1. Switch roles to **Manager** or **Teacher** using the top-right navbar pill.
2. Verify that parent phone numbers, emails, and home addresses are masked as `🔒 Hidden by Admin`.
3. Click `"Send System Reminder ✉️"` to verify the automated gateway dispatch.

### Test 5: Teacher 30-Second Sabaq Logger
1. Switch to **Teacher Portal**.
2. Click `"Log Sabaq ⚡"` or `"Open 30-Sec Sabaq Logger"`.
3. Select pills (`Present`, `Tajweed Focus`, `MashaAllah Good`) and click Save. Logged in under 30 seconds.

### Test 6: Interactive Month & Year Session Switcher (2020 - 2050+)
1. In the hero banner, click the calendar pill button (e.g. `October 2026 ⌵`).
2. A popover opens showing year navigation controls (`‹` and `›` stepper buttons), a comprehensive year selector spanning **2020 to 2050**, and a 3x4 grid of all 12 months.
3. Use `‹` / `›` or select any year from 2020 to 2050, then click any month (e.g. `March` or `November`). The active billing session dynamically updates across the entire application, updating overdue balances, the 12-Month Matrix active column, and KPI cards!

### Test 7: Registering New Students & Teachers (Admin Portal)
1. **To Add a Student:** Click `+ Add Student` in the top hero bar, in the 5th KPI card, or inside the **Full PII Directory** tab. Fill in student and guardian details, select course and assigned teacher, set monthly fee, and click **"Save & Enroll Student"**. The student is immediately added to state, roster, and fee matrix!
2. **To Add a Teacher:** In the **Teacher Payroll** tab or 5th KPI card, click `+ Add New Teacher`. Enter name, specialization, country, and hourly rate. The teacher is instantly added to faculty, payroll tracking, and student assignment dropdowns!
