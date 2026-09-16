# YarOperator — CTO Storage Policy & Data Storage Architecture

**Document Type:** Architecture Decision / CTO Policy
**Status:** APPROVED AS ARCHITECTURAL POLICY
**Scope:** YarOperator
**Primary Goals:** Minimum practical storage footprint + high runtime performance + data integrity + simple architecture + future scalability

---

# 1. هدف

YarOperator باید اطلاعات خود را با **کمترین حجم عملی** ذخیره کند، بدون اینکه فشرده‌سازی یا پیچیدگی ذخیره‌سازی باعث افت محسوس سرعت، افزایش غیرضروری مصرف CPU/RAM یا پیچیدگی معماری شود.

اصل اصلی:

> **Store data in the smallest practical representation that preserves required fidelity and keeps the normal access path fast.**

این Policy درباره **نحوه ذخیره‌سازی داده** است، نه درباره ساخت Memory، RAG، Knowledge Graph یا سیستم هوش مصنوعی.

---

# 2. اصول بنیادی معماری

## 2.1 Performance First on Hot Data

اطلاعاتی که دائماً در runtime استفاده می‌شوند نباید برای صرفه‌جویی جزئی در فضا، در هر request نیازمند decompress یا decode مجدد باشند.

برای Hot data اصل ترجیحی:

```text
Read
↓
Use
```

نه:

```text
Read
↓
Decompress
↓
Parse
↓
Transform
↓
Use
```

---

## 2.2 Compression Where It Actually Helps

Compression فقط زمانی استفاده شود که:

```text
Storage saving > CPU + latency + complexity cost
```

باشد.

Compression یک هدف مستقل نیست.

---

## 2.3 Never Recompress Already-Compressed Data

فرمت‌های ذاتاً فشرده نباید صرفاً برای کاهش جزئی حجم دوباره encode شوند.

Examples:

```text
JPEG
WebP
AVIF
MP3
Opus
MP4
H.264
H.265
AV1
ZIP
7z
RAR
GZIP
PDF
```

Recompression فقط در صورت وجود هدف مشخص، measurable و قابل rollback مجاز است.

---

## 2.4 Database for Structured Queryable State

هر داده‌ای که YarOperator باید روی آن:

```text
search
filter
sort
update
join
index
```

انجام دهد، باید در storage ساختاریافته مناسب قرار گیرد.

برای state محلی و فعلی YarOperator:

```text
SQLite
```

انتخاب پیش‌فرض است.

JSON فایل بزرگ نباید source of truth تمام state پروژه باشد.

---

## 2.5 Content Addressing

برای binary و payloadهای بزرگ:

```text
SHA-256(content)
```

به‌عنوان content identity/integrity identifier استفاده شود.

یک محتوای یکسان باید حتی‌المقدور فقط یک physical copy داشته باشد و چند reference منطقی بتوانند به آن اشاره کنند.

---

## 2.6 Cache Is Not Memory

Cache:

- source of truth نیست
- باید قابل حذف باشد
- باید قابل بازسازی باشد
- باید bounded باشد
- باید TTL یا eviction policy داشته باشد

Cache نباید به‌مرور تبدیل به Memory پنهان سیستم شود.

---

## 2.7 Original Data Preservation

Canonical/source data نباید فقط برای کاهش چند درصد storage با نسخه lossy جایگزین شود.

هر transformation باید مشخص کند:

```text
Source / Original
Derived / Optimized
Cache
Archive
```

کدام‌یک است.

---

## 2.8 One Canonical Source, Many Logical Representations

یک داده می‌تواند چند representation داشته باشد:

```text
Original
+
Runtime representation
+
Thumbnail / preview
+
Archive representation
```

اما نباید بدون دلیل چند physical copy مستقل از یک representation ایجاد شود.

---

## 2.9 Simplicity Before Distributed Infrastructure

YarOperator نباید برای storage از infrastructure سنگین استفاده کند مگر اینکه scale واقعی پروژه آن را توجیه کند.

تا زمان اثبات نیاز:

```text
SQLite
+
Filesystem Content Store
+
Bounded Cache
```

معماری پیش‌فرض است.

---

# 3. Storage Data Classes

YarOperator داده را ابتدا از نظر نقش و سپس از نظر access tier طبقه‌بندی می‌کند.

### Canonical

منبع اصلی یا داده‌ای که باید fidelity آن حفظ شود.

Examples:

```text
Original PDF
Original attachment
Original uploaded media
Canonical structured record
User-provided source
```

Canonical data منبع حقیقت است.

---

### Derived

داده‌ای که از یک canonical/source ساخته شده است.

Examples:

```text
Thumbnail
WebP preview
Extracted text
Generated preview
Compressed archive representation
Search index representation
```

Derived data قابل بازسازی است، مگر اینکه صراحتاً به‌عنوان source of truth ثبت شده باشد.

---

### Cache

داده‌ای که در صورت حذف می‌توان آن را دوباره تولید کرد.

Cache source of truth نیست.

---

### Archive

داده‌ای که برای retention نگهداری می‌شود اما در مسیر عادی runtime نیست.

---

### Temporary

داده‌ای که فقط برای یک operation لازم است.

Examples:

```text
Upload staging
Temporary extraction
Intermediate processing files
Transient exports
```

Temporary data باید پس از اتمام operation حذف شود، مگر retention آن صراحتاً لازم باشد.

---

# 4. Storage Tiers

## 4.1 HOT

داده‌ای که دائماً در runtime استفاده می‌شود.

Examples:

```text
Current Task
Current Session
Active State
Recent Messages
Active Approval State
Current Execution State
```

Policy:

```text
SQLite / native structured storage
UTF-8
No heavy compression
Fast indexed access
```

---

## 4.2 WARM

داده‌ای که مرتباً استفاده می‌شود ولی در هر request لازم نیست.

Examples:

```text
Recent Task History
Verified Facts
Project Knowledge
Recent Reports
Operational Records
```

Policy:

```text
SQLite
Indexed fields
Compression only for genuinely large payloads
```

---

## 4.3 COLD

داده‌ای که نگهداری آن لازم است ولی به ندرت خوانده می‌شود.

Examples:

```text
Old Logs
Old Conversations
Archived Reports
Historical Execution Records
```

Policy:

```text
Archive storage
Zstandard where beneficial
Finite retention
```

---

## 4.4 BINARY

داده‌های بزرگ غیرمتنی.

Examples:

```text
Images
Audio
Video
PDF
Attachments
Archives
```

Policy:

```text
Filesystem / content store
+
metadata in SQLite
+
content hash
```

---

# 5. Text Storage Policy

## 5.1 Canonical Encoding

تمام متن canonical باید:

```text
UTF-8
```

باشد.

از encodingهای متعدد برای یک نوع داده استفاده نشود.

---

## 5.2 Unicode Normalization

در boundary ورود، normalization فقط در صورت نیاز انجام شود.

متن اصلی کاربر نباید بدون دلیل تغییر کند.

---

## 5.3 Text Compression

Small / Hot:

```text
No compression
```

Large / Cold:

```text
Zstandard where beneficial
```

---

## 5.4 Searchable Text

متن قابل جست‌وجو باید در:

```text
SQLite TEXT
```

یا ساختار indexed مناسب نگهداری شود.

فایل JSON بزرگ نباید جایگزین storage queryable شود.

---

# 6. JSON Policy

JSON برای موارد زیر مناسب است:

```text
API payload
Configuration
Debug/export
Small structured documents
Interchange
```

اما JSON نباید storage اصلی تمام state باشد.

### Rule

Small:

```text
JSON UTF-8
```

Large / frequently queried:

```text
SQLite
```

Large opaque JSON:

```text
SQLite metadata
+
compressed payload when beneficial
```

---

# 7. Database Policy

## 7.1 Primary Database

برای state ساختاریافته YarOperator:

```text
SQLite
```

انتخاب پیش‌فرض است، تا زمانی که scale واقعی پروژه نیاز به database server جداگانه را اثبات کند.

دلایل:

- حجم کم
- zero external database service
- transaction support
- indexing
- fast local access
- ساده بودن backup
- معماری ساده

---

## 7.2 Entity Rules

هر entity مهم در صورت نیاز باید حداقل:

```text
stable ID
created_at
updated_at
```

داشته باشد.

برای داده بزرگ:

```text
metadata → SQLite
content → Content Store
```

---

## 7.3 SQLite BLOB Rule

Binary کوچک و access pattern مناسب می‌تواند داخل SQLite ذخیره شود.

اما binary بزرگ، streaming-oriented یا پرتعداد ترجیحاً در Content Store قرار گیرد.

بنابراین:

> SQLite BLOB ممنوع مطلق نیست؛ استفاده از آن باید تابع اندازه و access pattern باشد.

---

# 8. Binary Storage Policy

Binaryهای بزرگ نباید به‌صورت پیش‌فرض در رکوردهای عادی SQLite نگهداری شوند.

ساختار پیشنهادی:

```text
SQLite
 ├── content_id
 ├── sha256
 ├── mime_type
 ├── size_bytes
 ├── original_name
 ├── created_at
 ├── storage_class
 └── storage_path / content locator

Filesystem / Content Store
 └── actual bytes
```

---

# 9. Content-Addressed Storage

ساختار فیزیکی می‌تواند به صورت:

```text
content/
  ab/
    cd/
      abcdef....
```

یا هر ساختار معادل مبتنی بر hash باشد.

نام فیزیکی فایل source of truth نیست.

Identity:

```text
content_id
+
SHA-256
```

است.

---

# 10. Deduplication Policy

هر binary بزرگ پیش از permanent storage:

```text
SHA-256(content)
```

محاسبه می‌کند.

سپس:

```text
SHA-256
   ↓
Existing?
 ├── YES → reuse existing physical content
 └── NO  → store new content
```

مثال:

```text
image.jpg
image-copy.jpg
image-uploaded-again.jpg
```

اگر bytes یکسان باشند:

```text
ONE physical copy
+
THREE logical references
```

نه سه فایل مستقل.

Dedup نباید باعث شود metadata یا references منطقی حذف شوند.

---

# 11. Image Policy

## 11.1 Runtime Representation

برای تصاویر جدیدی که YarOperator خودش تولید یا optimize می‌کند، در سناریوهای web/runtime:

```text
WebP
```

انتخاب مناسب پیش‌فرض است.

---

## 11.2 Original

Original فقط زمانی قابل حذف است که retention policy صراحتاً اجازه دهد.

Original معمولاً باید حفظ شود وقتی:

- fidelity اهمیت دارد
- reprocessing ممکن است
- کاربر فایل اصلی را نیاز دارد
- metadata/source provenance مهم است
- فایل canonical محسوب می‌شود

---

## 11.3 Derived Images

در صورت نیاز:

```text
Original
+
Thumbnail
+
Optional medium preview
```

ممکن است وجود داشته باشد.

Derived images باید identifiable و reproducible باشند.

---

## 11.4 Lossy Conversion

برای تصاویر غیرcanonical، WebP lossy می‌تواند استفاده شود.

برای موارد حساس به fidelity:

```text
WebP lossless
```

یا format مناسب دیگر استفاده شود.

هیچ lossless/lossy conversion نباید به‌صورت مخفی source را جایگزین کند.

---

# 12. Audio Policy

برای audio تولیدشده یا قابل تبدیل:

```text
Opus
```

فرمت فشرده ترجیحی است.

اما audio ورودی که از قبل فشرده است نباید بدون هدف مشخص دوباره encode شود.

Original زمانی حفظ شود که:

```text
reprocessing
quality
source fidelity
legal/provenance
```

اهمیت داشته باشد.

---

# 13. Video Policy

Video از بزرگ‌ترین مصرف‌کنندگان storage است.

اصل:

> **Never transcode automatically unless required.**

برای محتوای جدید یا archival در صورت پشتیبانی کامل pipeline:

```text
AV1
```

یا:

```text
H.265 / HEVC
```

ممکن است مناسب باشد.

برای compatibility گسترده:

```text
H.264
```

می‌تواند انتخاب شود.

انتخاب codec باید بر اساس:

```text
storage size
CPU cost
encoding time
decode support
required quality
```

باشد.

هیچ transcoding سراسری یا خودکاری در این Policy فعال نمی‌شود.

---

# 14. PDF Policy

PDF به‌صورت پیش‌فرض:

```text
Keep original PDF
```

است.

Metadata:

```text
filename
mime_type
size
sha256
created_at
source
```

در SQLite ثبت می‌شود.

PDF فقط در یک فرآیند explicit و قابل rollback قابل optimization/recompression است.

---

# 15. Logs Policy

Logs سه lifecycle اصلی دارند.

## 15.1 Active Logs

```text
Plain text / structured lines
```

هدف:

```text
fast write
fast troubleshooting
```

Compression سنگین روی active logs انجام نشود.

---

## 15.2 Rotated Logs

پس از rotation:

```text
Zstandard
```

در صورت beneficial بودن.

---

## 15.3 Archived Logs

Retention مشخص و finite:

```text
Active
→ Rotate
→ Compress
→ Retain
→ Delete
```

Infinite logs ممنوع است.

---

# 16. Cache Policy

هر cache item در صورت persistence باید حداقل بتواند به:

```text
key
created_at
expires_at / TTL
size_bytes
```

شناخته شود.

Cache باید:

```text
rebuildable
evictable
bounded
```

باشد.

در صورت کمبود storage:

```text
Cache is deleted before important data.
```

Cache نباید برای جلوگیری از طراحی صحیح Memory استفاده شود.

---

# 17. Memory Policy

این سند **Memory implementation را فعال نمی‌کند**.

Memory در M8 باید جداگانه طراحی شود و حداقل این دسته‌ها را از هم متمایز کند:

```text
User Preferences
Verified Facts
Project Knowledge
Important Decisions
Operational Experience
Conversation History
```

Memory نباید صرفاً تمام conversationها را نگهداری کند.

اصل:

> **Store useful knowledge, not everything by default.**

Memory:

```text
≠ Cache
≠ Archive
≠ Raw conversation dump
```

Deduplication و retention برای Memory الزامی خواهند بود.

---

# 18. Attachments Policy

هر attachment باید metadata داشته باشد:

```text
content_id
sha256
mime_type
size_bytes
original_filename
created_at
source
storage_class
```

Actual content:

```text
Content Store
```

Metadata:

```text
SQLite
```

---

# 19. Temporary Data Policy

Temporary data باید:

```text
bounded
identifiable
deletable
```

باشد.

Examples:

```text
Upload staging
Temporary extraction
Intermediate files
Transient exports
Temporary browser artifacts
```

قاعده:

```text
Create
→ Use
→ Verify
→ Delete
```

اگر retention لازم است، داده باید از Temporary به یک storage class رسمی منتقل شود.

---

# 20. Compression Decision Matrix

| Data           | HOT                               | WARM                       | COLD                                          |
| -------------- | --------------------------------- | -------------------------- | --------------------------------------------- |
| Text           | UTF-8                             | UTF-8                      | Zstd where beneficial                         |
| JSON           | JSON                              | JSON / SQLite              | Zstd where beneficial                         |
| SQLite records | Native                            | Native                     | Archive/export                                |
| Logs           | Plain / structured                | Rotated                    | Zstd                                          |
| Images         | Existing/optimized runtime format | WebP where appropriate     | Existing format / archive                     |
| Audio          | Existing / Opus where appropriate | Opus where appropriate     | Existing / Opus where appropriate             |
| Video          | Existing efficient codec          | Existing                   | Efficient codec only when explicitly required |
| PDF            | Original                          | Original                   | Original                                      |
| Cache          | Uncompressed where possible       | Bounded                    | Expire/delete                                 |
| Attachments    | Native/source representation      | Native/derived as required | Content Store                                 |

---

# 21. What Must NOT Be Done

در وضعیت فعلی YarOperator موارد زیر بدون نیاز اثبات‌شده ممنوع هستند:

```text
❌ Vector Database
❌ RAG infrastructure
❌ Knowledge Graph
❌ Distributed object storage
❌ PostgreSQL cluster
❌ Redis فقط برای cache
❌ Compression on every request
❌ Automatic video transcoding
❌ Automatic PDF conversion
❌ Duplicate storage systems
❌ Separate Capability/Memory storage architecture
❌ Raw conversation dump as permanent memory
❌ Infinite cache growth
❌ Infinite log retention
```

---

# 22. Performance Rules

Storage optimization نباید access path داده Hot را پیچیده کند.

برای Hot data ترجیح:

```text
Read
↓
Use
```

برای Cold data:

```text
Read
↓
Decompress if necessary
↓
Use
```

Compression باید عمدتاً در:

```text
archive
cold storage
large payload
```

اعمال شود.

Benchmark قبل از adoption هر storage transformation بزرگ لازم است.

---

# 23. Retention Policy

هر storage class باید retention مشخص داشته باشد.

Examples:

```text
Cache
→ TTL / eviction

Temporary files
→ Delete after completion

Active logs
→ Short retention

Archived logs
→ Finite retention

Task artifacts
→ Policy-based retention

Conversation history
→ Memory/retention policy

Original media
→ Explicit retention policy

Derived data
→ Rebuildability-based retention
```

هیچ category نباید به‌صورت نامحدود و بدون دلیل رشد کند.

---

# 24. Integrity Policy

برای content مهم:

```text
SHA-256
```

باید به‌عنوان identity/integrity identifier ثبت شود.

در صورت نیاز:

```text
size
mime_type
created_at
```

نیز verify شوند.

در هنگام انتقال یا restore، integrity verification باید امکان‌پذیر باشد.

---

# 25. Atomic Storage Rules

ذخیره binary نباید طوری انجام شود که metadata به محتوای ناقص اشاره کند.

الگوی ترجیحی:

```text
Write temporary content
↓
Verify size/hash
↓
Atomically finalize content
↓
Commit metadata/reference
```

Failure باید بتواند temporary artifact را پاک‌سازی کند.

---

# 26. Security & Sensitive Data

Storage policy باید با security policy هماهنگ باشد.

Secrets و credentials نباید صرفاً چون storage موجود است به‌صورت unrestricted ذخیره شوند.

برای داده حساس، implementation آینده باید مشخص کند:

```text
what is stored
why it is stored
where it is stored
how long it is retained
who/what can access it
```

Encryption at rest فقط زمانی اضافه شود که threat model و نیاز واقعی آن را توجیه کنند؛ اما sensitive data نباید به‌طور پیش‌فرض در log، cache یا archive نشت کند.

---

# 27. Backup Policy

Backup باید قابلیت restore واقعی داشته باشد.

Backup logical scope:

```text
Database
+
Content Store
+
Required Configuration / Metadata
```

Backup نباید صرفاً:

```text
copy entire application directory
```

باشد.

Deduplicated content باید تا حد امکان در backup نیز deduplicated بماند.

Backup verification باید شامل:

```text
integrity check
restore test
metadata/content consistency
```

باشد.

---

# 28. Migration Rule

هر storage migration باید:

1. Backward compatible باشد، یا مسیر مهاجرت صریح داشته باشد.
2. Rollback strategy داشته باشد.
3. قبل از migration benchmark شود، اگر performance تحت تأثیر است.
4. Data integrity verification داشته باشد.
5. در صورت failure امکان recovery داشته باشد.

هیچ migration بزرگی فقط برای کاهش جزئی حجم انجام نشود.

---

# 29. Current Architecture Decision

در وضعیت فعلی YarOperator:

```text
Canonical Text
        ↓
UTF-8

Structured State
        ↓
SQLite

Large Binary
        ↓
Content Store

Large / Cold Text
        ↓
Zstd

Images
        ↓
Runtime-optimized representation
+
Original when required

Audio
        ↓
Opus where conversion is appropriate

Video
        ↓
Existing efficient codec
or explicitly selected codec when required

PDF
        ↓
Original

Attachments
        ↓
Content Store + SQLite metadata

Duplicates
        ↓
SHA-256 content deduplication

Cache
        ↓
Bounded + TTL + deletable

Temporary
        ↓
Create → Use → Verify → Delete

Memory
        ↓
Separate future architecture
```

---

# 30. Implementation Timing

این Policy به‌معنی اجرای کامل Storage System در M4 یا M5 نیست.

ترتیب:

```text
M2  ✅ Brain → Execution
M3  ✅ Capability Resolution
M4  ✅ Task Executor
M5  ✅ Internet Operator
M6  → Controlled Mutations
M7  → Self Planning
M8  → Memory
```

Storage implementation باید فقط زمانی وارد کد production شود که یک مرحله واقعاً به آن نیاز داشته باشد.

---

## 30.1 Current Implementation Rule

در مرحله فعلی:

```text
Policy = Active
Implementation = Incremental / Need-driven
```

یعنی Policy از همین حالا قرارداد معماری است، اما implementation آن در هر phase فقط به اندازه نیاز همان phase انجام می‌شود.

---

# 31. Phase Gating for Storage

قبل از ایجاد هر storage subsystem جدید، باید مشخص شود:

```text
1. What data requires persistence?
2. What is the source of truth?
3. Is it HOT / WARM / COLD / BINARY?
4. Is it canonical / derived / cache / temporary?
5. What is the retention requirement?
6. Can it be rebuilt?
7. Can it be deduplicated?
8. Is SQLite sufficient?
9. Does a Content Store actually need to exist now?
10. Does compression provide measurable benefit?
```

اگر پاسخ نشان دهد زیرساخت جدید لازم نیست:

```text
Do not build it.
```

---

# 32. Storage Decision Hierarchy

برای هر feature جدید، این ترتیب تصمیم رعایت شود:

```text
Existing storage capability?
        ↓ YES
Reuse it

        ↓ NO
SQLite sufficient?
        ↓ YES
Use SQLite

        ↓ NO
Filesystem Content Store sufficient?
        ↓ YES
Use Content Store + SQLite metadata

        ↓ NO
Add the smallest justified subsystem
```

Infrastructure نباید قبل از نیاز واقعی ساخته شود.

---

# 33. CTO Gate

## APPROVED POLICY

YarOperator باید:

- کمترین حجم عملی را هدف بگیرد.
- داده Hot را سریع نگه دارد.
- داده Cold را در صورت توجیه فشرده کند.
- Binaryهای بزرگ را خارج از رکوردهای معمولی DB نگه دارد.
- از representation مناسب برای media استفاده کند.
- originalهای مهم را حفظ کند.
- duplicate binary را با content hashing کاهش دهد.
- Cache را bounded و قابل حذف نگه دارد.
- Temporary data را finite و قابل حذف نگه دارد.
- Memory را از Cache و Archive جدا نگه دارد.
- از infrastructure سنگین بدون نیاز واقعی جلوگیری کند.
- backup و restore را به‌عنوان بخشی از integrity در نظر بگیرد.
- Storage implementation را phase-aware و need-driven نگه دارد.

---

# 34. Final Principle

> **Do not optimize for minimum bytes at the expense of runtime simplicity. Optimize for minimum practical storage with maximum useful performance and preserved data integrity.**

---

# 35. Final CTO Status

**STORAGE POLICY: APPROVED**

**ARCHITECTURE CONTRACT: ACTIVE**

**FULL STORAGE IMPLEMENTATION: DEFERRED UNTIL REQUIRED BY ROADMAP**

**MEMORY IMPLEMENTATION: DEFERRED TO M8**

**VECTOR DB / RAG / DISTRIBUTED STORAGE: NOT APPROVED AT THIS STAGE**
