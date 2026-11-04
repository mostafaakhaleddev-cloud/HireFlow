# HireFlow AI

تطبيق توظيف لشركة واحدة: **Jobs → Applications → Human review → Invitation → Booking → Calendar sync**.

الواجهة والعقود بالإنجليزي. Next.js App Router + TypeScript strict + Tailwind + Zod، وSupabase Auth/PostgreSQL/private Storage. الـdispatcher والـn8n simulator برامج منفصلة. مفيش قبول/رفض أو درجات ملاءمة تلقائية.

**الحالة الفعلية:** [docs/STATUS.md](docs/STATUS.md). التنفيذ موجود عبر المراحل، لكن رحلة المتصفح الكاملة وSupabase Auth/Storage لسه محتاجين Docker متاح. اختبارات PostgreSQL المنفصلة مش إثبات لتكامل Supabase أو المزودين الحقيقيين.

## تشغيل محلي — Windows / PowerShell

المطلوب: Node.js 22.23+ متوافق، npm، وDocker Desktop بوضع Linux containers شغّال ومتاح. Supabase CLI مثبت النسخة ضمن الحزم. مفيش cloud keys مطلوبة.

```powershell
Set-Location C:\Users\RDP\Documents\ChatGPT\HireFlow
npm ci
npm run db:start
npm run setup:local
npm run bootstrap
npm run seed
npm run dev
```

افتح [التطبيق المحلي](http://127.0.0.1:3000). `setup:local` بيقرأ مفاتيح Supabase المحلي وبيولّد أسرار وباسورد عشوائيين في `.env.local` المتجاهل من Git. خد بيانات الدخول من `BOOTSTRAP_EMAIL` و`BOOTSTRAP_PASSWORD` محليًا وماتشاركش محتوى الملف. Bootstrap بيرفض المشاريع المستضافة وبيسمح بـ`@example.test` فقط.

في نافذتين إضافيتين بنفس المجلد:

```powershell
# Terminal 2
npm run simulator
```

```powershell
# Terminal 3
npm run worker
```

المحاكي على `127.0.0.1:4001`؛ مابيستدعيش Gemini/Gmail/Calendar. النتائج والـMeet link صناعية، والواجهة بتوضح ده. المتصفح ماعندوش أسرار تكامل.

## رحلة الاستخدام

1. ادخل كـHR، افتح Jobs واضغط Create job. استخدم مثلًا `JOB-BE-002`؛ `JOB-BE-001` موجود في الـseed.
2. انسخ Application link وافتحه كمتقدم. استخدم بيانات وCV صناعيين. `scripts/fixtures.ts` فيه مولّد PDF صالح للاختبار.
3. قدّم الطلب، افتح Candidates واعمل refresh، وافتح التقديم ونزّل الـCV الأصلي الخاص بيه.
4. بعد تشغيل worker + simulator راجع أدلة التحليل. اختار interviewer وسجّل سبب الموافقة البشرية التجريبية.
5. افتح synthetic booking link في صفحة التقديم، واختار وقت منشور من Interviews. يفضل pending لحد callback المحاكي؛ بعد refresh يظهر confirmed.
6. افتح Gmail item غير المعيّن من Candidates، اختار وظيفة مفتوحة وراجع نتيجة التحليل.

Seed قابل للإعادة: وظيفتين، تقديمين لنفس الشخص بملفين مختلفين، Gmail item محتاج تعيين وأوقات مستقبلية. مابيمسحش البيانات الموجودة. `npm run db:reset` بيمسح ويعيد **قاعدة المشروع المحلي**؛ استخدمه بس لو ده مقصود لبيانات الاختبار.

## الفحوصات

```powershell
npm run check
# typecheck + lint + unit tests + production build

# بعد تشغيل Supabase والويب والمحاكي:
npm run test:db
npm run smoke
```

`smoke` بيستخدم Supabase sign-in حقيقي محليًا، وينشئ وظيفة وCV خاص وتقديم وقرار تجريبي وحجز، ويتحقق من بايتات الملف وتكرار الطلب، وكمان Gmail assignment. الإرسال وCalendar محاكاة.

اختبارات invariants المنفصلة بتحتاج PostgreSQL 17 محلي شغّال على port 55432. بتستخدم **auth/storage schemas تجريبية**؛ مابتختبرش Supabase Auth/Storage:

```powershell
$env:TEST_POSTGRES_URL = 'postgresql://postgres@127.0.0.1:55432/postgres'
npm run test:postgres
```

الأداة بتنشيء وتحذف قاعدة مؤقتة باسم `hireflow_test_*` وتطبّق الهجرة الفعلية وتختبر السباقات والصلاحيات. استخدم cluster اختبار منفصل فقط. أوامر تشغيله موجودة في [OPERATIONS](docs/OPERATIONS.md).

## تسليم الأتمتة

- [docs/INTEGRATION.md](docs/INTEGRATION.md): المسارات، التوقيع، المفاتيح والـretry.
- [docs/contracts/openapi.json](docs/contracts/openapi.json): OpenAPI 3.1.
- `docs/contracts/*.schema.json` و`fixtures.json`: schemas وطلبات/ردود صناعية.
- `src/lib/contracts.ts` و`scripts/client.ts`: التحقق ومثال توقيع شغّال.
- `scripts/simulator.ts`, `scripts/worker.ts`, `scripts/smoke.ts`: التشغيل المرجعي.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): التعافي والنسخ الاحتياطي والـretention.

```powershell
npm run simulator:mode -- duplicate
npm run simulator:mode -- timeout
npm run simulator:mode -- uncertain-send
npm run simulator:mode -- calendar-failure
npm run simulator:mode -- normal
npm run simulator:mode -- reminders
```

قبل private staging: Supabase فعلي، حساب DB محدود وHTTPS، scanner شغّال، سياسات خصوصية/احتفاظ معتمدة، backup للـDB **والملفات**، فحوصات المتصفح والحمل، وتوصيل n8n بحسابات Gmail/Calendar/Gemini/OCR اختبار مع free/busy وإثبات إرسال لمستلم اختبار معتمد. مفيش نشر إنتاجي أو إرسال لأشخاص حقيقيين اتعمل.

Production: `npm run build` ثم `npm start`. الاستضافة لازم تدعم Node.js وطلب binary كامل 5 MiB؛ الرفع مش Server Action. لو المنصة حدها أقل، امنع الإطلاق لحد إضافة direct private quarantine upload intents. المسار الحالي لا يتجاوز حدود المنصة تلقائيًا.
