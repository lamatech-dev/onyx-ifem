# چک‌لیست کامل پروژه ONYX IFEM

## راه‌اندازی و GitHub

- [x] ساخت و تنظیم repository پروژه
- [x] اتصال پروژه محلی به GitHub
- [x] تنظیم شاخه `main`
- [x] commit و push مرحله‌ای تغییرات
- [x] همگام‌سازی نهایی `HEAD` با `origin/main`
- [x] تمیز بودن worktree
- [x] ثبت اصلاح نهایی پوشش integrity در commit `a91c708`

## قراردادهای Machine-Readable

- [x] بررسی فایل Word و بسته قراردادهای اولیه
- [x] تطبیق مسیر‌به‌مسیر تمام ۳۷۲ فایل inventory بستهٔ اصلی
- [x] نگهداری README و SHA-256 inventory اولیه برای provenance
- [x] تکمیل تمام ۲۹۴ قرارداد
- [x] تکمیل ۱۴۴ Command schema
- [x] تکمیل ۱۵۰ Event schema
- [x] حذف کامل وضعیت `payload-open`
- [x] تبدیل تمام قراردادها به `FIELD_COMPLETE`
- [x] استفاده از JSON Schema Draft 2020-12
- [x] تعریف payloadهای strict با `additionalProperties: false`
- [x] تعیین تمام فیلدهای required
- [x] کنترل UUIDv7، timestamp، enum، reference و محدودیت فیلدها
- [x] هماهنگ‌سازی package manifest با schemaها
- [x] به‌روزرسانی compatibility و provenance قراردادها

## Codegen و Validation بستهٔ اصلی

- [x] بازیابی کامل `codegen/rust`
- [x] افزودن `EventEnvelope` جاافتاده به SDK زبان Rust
- [x] تطبیق ۱۴۴ Command و ۱۵۰ Event زبان Rust با manifest
- [x] serialization صحیح actor type و optional fieldهای Rust
- [x] قفل وابستگی‌های Rust با `Cargo.lock`
- [x] format، build، unit test و doc-test زبان Rust
- [x] بازیابی کامل `codegen/typescript`
- [x] تطبیق ۱۴۴ Command و ۱۵۰ Event زبان TypeScript با manifest
- [x] قفل مستقل وابستگی‌های TypeScript
- [x] typecheck و production build بستهٔ TypeScript
- [x] بازیابی fixtureها و تست اجرایی Python
- [x] حذف API منسوخ `RefResolver` از validator زبان Python
- [x] قفل dependency زبان Python در `validation/requirements.txt`
- [x] ثبت validation report جدید بر اساس اجرای واقعی
- [x] افزودن gate خودکار برای جلوگیری از حذف دوباره artifactها
- [x] افزودن Rust، Python و هر دو codegen به CI و release
- [x] افزودن Cargo و Pip به Dependabot

## پیاده‌سازی ۱۸ Context

- [x] Mission
- [x] Work
- [x] Organization
- [x] Identity & Authority
- [x] Context Link
- [x] Meeting
- [x] Communication
- [x] File
- [x] Reporting & Evidence
- [x] Approval
- [x] Timeline
- [x] Capacity
- [x] Forecasting
- [x] Automation
- [x] Notification
- [x] Synchronization
- [x] Audit
- [x] Policy

برای هر Context موارد زیر تکمیل شده است:

- [x] Domain types
- [x] Command validation
- [x] Service و runtime handlers
- [x] In-memory repository
- [x] SQLite repository
- [x] Event generation
- [x] Idempotency
- [x] Optimistic concurrency
- [x] Lifecycle و authority epoch fencing
- [x] List، Get و History queries
- [x] API routes
- [x] OpenAPI schemas
- [x] UI actions
- [x] مستندات
- [x] تست‌های lifecycle و persistence

## Runtime و منطق دامنه

- [x] اجرای واقعی تمام ۱۴۴ Command
- [x] تولید و اعتبارسنجی تمام ۱۵۰ Event
- [x] بررسی authority proof و scope
- [x] کنترل expiration مجوزها
- [x] کنترل organization boundary
- [x] جلوگیری از استفاده مجدد متفاوت از `operation_id`
- [x] بازگرداندن نتیجه اصلی برای replay یکسان
- [x] کنترل state transitionهای غیرمجاز
- [x] بررسی ارتباط بین Contextها
- [x] پشتیبانی از event history
- [x] تولید integrity digest برای Eventها
- [x] اعتبارسنجی Event پیش از commit

## Persistence و SQLite

- [x] ذخیره aggregate state
- [x] ذخیره immutable event history
- [x] ذخیره operation fingerprint
- [x] Transactional outbox
- [x] Inbox deduplication
- [x] Migration و schema versioning
- [x] Optimistic concurrency در سطح دیتابیس
- [x] Atomic commit برای state، event، operation و outbox
- [x] Rollback کامل در صورت خطا
- [x] بازیابی state پس از restart برای تمام Contextها
- [x] حفظ idempotency پس از restart
- [x] اعتبارسنجی fail-closed برای Eventهای هر ۱۸ Context
- [x] تطابق whitelist دیتابیس با تمام ۱۵۰ Event
- [x] تشخیص خرابی event body، digest و row metadata
- [x] جلوگیری از lease گرفتن outbox خراب
- [x] Backup، restore و verification دیتابیس
- [x] تشخیص backup خراب
- [x] پشتیبانی از WAL و foreign key enforcement

## Timeline و رویدادهای زمان‌محور

- [x] Deadline management
- [x] Milestone management
- [x] Critical Marker
- [x] Penalty Zone
- [x] Schedule Exception
- [x] تولید `DeadlineReached`
- [x] تولید `CriticalMarkerReached`
- [x] تضمین exactly-once محلی برای signalهای موعد
- [x] حفظ وضعیت signalها بعد از restart

## API و OpenAPI

- [x] API اجرایی برای هر ۱۴۴ Command
- [x] List، Get و History API برای هر Context
- [x] مجموع ۲۰۲ مسیر OpenAPI
- [x] مجموع ۲۰۲ operation یکتا
- [x] Bundle شدن تمام schema referenceها
- [x] مستندسازی تمام ۱۴۴ Command
- [x] مستندسازی تمام ۱۵۰ Event schema
- [x] پاسخ‌های استاندارد خطا
- [x] پاسخ‌های `400`، `401`، `403`، `404`، `409`، `422`، `429`، `500` و `503`
- [x] Bearer authentication documentation
- [x] نمایش خودکار host و port واقعی در `servers`
- [x] OpenAPI فعال روی API محلی

## Authentication و امنیت

- [x] پشتیبانی از JWT با Ed25519
- [x] بررسی issuer و audience
- [x] بررسی expiration
- [x] کنترل organization و actor binding
- [x] Scope-based authorization
- [x] Authority epoch validation
- [x] Request ID
- [x] محدودیت اندازه request body
- [x] کنترل Content-Type و UTF-8
- [x] جلوگیری از compressed body نامعتبر
- [x] Rate limiting
- [x] Concurrency limiting
- [x] Timeoutهای bounded
- [x] Security headers
- [x] Graceful shutdown
- [x] عدم نمایش credential در خطاها و logها

## رابط گرافیکی

- [x] ساخت ONYX Operations Command Center
- [x] داشبورد و navigation
- [x] پنل گرافیکی برای تمام ۱۸ Context
- [x] کنترل گرافیکی تمام ۱۴۴ Command
- [x] فرم ایجاد و تغییر Mission
- [x] مدیریت Task
- [x] کنترل‌های Assign Owner، Priority و Dependency
- [x] مدیریت Timeline و Deadline
- [x] Reporting و Evidence workflow
- [x] مدیریت Organization و User
- [x] Meeting و Communication
- [x] File upload lifecycle
- [x] Approval workflow
- [x] Capacity و Forecast
- [x] Automation و Notification
- [x] Synchronization و Conflict
- [x] Audit و Policy
- [x] نمایش Record detail و Event history
- [x] رابط responsive
- [x] API proxy محلی
- [x] Metadata و Open Graph image

## Observability و عملیات

- [x] Health endpoint
- [x] Readiness endpoint
- [x] Metrics endpoint
- [x] Structured JSON logs
- [x] Prometheus metrics
- [x] ۱۰ پنل Grafana
- [x] ۱۱ قانون Prometheus
- [x] Outbox worker
- [x] HTTPS event publisher
- [x] Retry با exponential backoff
- [x] Dead-letter handling
- [x] Lease recovery
- [x] Graceful stack startup و shutdown
- [x] Docker configuration
- [x] Deployment و Kubernetes documentation
- [x] Disaster-recovery documentation

## Gateهای اعتبارسنجی

- [x] `npm run validate:contracts`
- [x] `npm run validate:openapi`
- [x] `npm run validate:completion`
- [x] `npm run validate:artifact-package`
- [x] `npm run validate:monitoring`
- [x] TypeScript typecheck
- [x] بررسی ۳۵۷ فایل JSON
- [x] بررسی strict بودن payloadها
- [x] بررسی وجود سه Query contract برای هر Context
- [x] بررسی runtime و UI تمام Commandها
- [x] بررسی runtime و OpenAPI تمام Eventها
- [x] بررسی SQLite profile تمام Eventها
- [x] اجرای همه gateها در `npm run check`
- [x] اجرای `npm run check:artifacts`
- [x] اجرای Python fixture assertions
- [x] اجرای TypeScript SDK typecheck و build
- [x] اجرای Rust fmt، build، unit test و doc-test

## تست‌های نهایی

- [x] ۱۳۹ تست backend از ۱۳۹ تست
- [x] ۲۱ تست اختصاصی SQLite persistence
- [x] تست corruption برای Contextهای اولیه
- [x] تست corruption برای Contextهای بعدی مانند Policy
- [x] تست idempotency
- [x] تست authorization
- [x] تست HTTP واقعی
- [x] تست outbox و inbox
- [x] تست backup و recovery
- [x] تست Timeline due signals
- [x] تست lifecycle تمام Contextها
- [x] UI lint موفق
- [x] UI production build موفق
- [x] ۲ تست rendered UI از ۲ تست
- [x] تست کامل اجرای local stack موفق

## وضعیت نهایی

- [x] API روی `http://127.0.0.1:3001`
- [x] UI روی `http://localhost:3002`
- [x] تمام قراردادها کامل
- [x] تمام تست‌ها سبز
- [x] پروژه با GitHub همگام
- [x] هدف تکمیل پروژه بسته شده است
