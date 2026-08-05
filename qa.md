# QA — ручной прогон сквозного флоу

Полный путь: dev-токен → кошельки → секреты → платёж → купон → claim →
аттестации → релей → settlement → транзакции и балансы.

Всё под префиксом `/api`, кроме `/health`. Базовый URL ниже — `http://localhost:3000`.

Условные обозначения:

- **[локально]** — работает без внешних зависимостей;
- **[нужен индексер]** — требует `INDEXER_API_KEY` и реальный платёж на mainnet;
- **[нужна Sepolia]** — требует RPC Sepolia и профинансированный кошелёк релеера.

---

## 0. Подготовка стенда

```bash
npm ci
cp .env.example .env                 # DB, indexer key, адреса контрактов, RPC-карты
npm run docker:up                    # Postgres + Redis + Adminer
npm run migration:run                # 13 миграций
NODE_ENV=development npm run seed     # тестовый юзер + демо-подписанты (issuer/relayer/guardian)
npm run dev
```

Проверки перед стартом флоу:

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 0.1 | `curl -s localhost:3000/health` | `200`, `{"status":"ok","database":"connected"}` |
| 0.2 | Открыть `http://localhost:3000/docs` | Swagger UI отдаёт все теги: auth, wallets, secrets, coupons, claims, transactions, balances |
| 0.3 | `curl -s localhost:3000/api/config` | `cashbackBps`, `utlUsdRate`, `confirmationDepths`, `secretsKdfFloor` (argon2id, m=65536, t=3, p=1) |
| 0.4 | Убрать `JWT_SECRET` из `.env` и стартовать | Процесс падает на старте (Zod fail-fast), а не в рантайме |
| 0.5 | Задать один и тот же RPC двум процессам | Процесс отказывается стартовать (кроме чейнов из `RPC_SHARING_ALLOWED_CHAINS`) |

Полезно держать открытым Adminer (`localhost:8080`) — половина проверок ниже смотрит в БД.

---

## 1. Аутентификация [локально]

Есть два способа получить токен. Для claim-флоу нужен **скрипт**, потому что
только он даёт приватный ключ, которым можно подписать челлендж.

### 1.1 Скрипт (основной путь)

```bash
npm run dev:token
```

Печатает три строки — сохранить все:

```
userId:  <uuid>            # пользователь в БД
address: 0xf39Fd6e5...     # Hardhat account #0, наш «кошелёк устройства»
token:   eyJhbGciOi...     # JWT, который принимает guard
```

```bash
export TOKEN=<token>
export ADDR=<address>
```

### 1.2 HTTP-эндпоинты

| # | Запрос | Ожидаем |
| - | ------ | ------- |
| 1.1 | `POST /api/auth/dev/test-token` при `NODE_ENV=development` | `200`, пара access/refresh |
| 1.2 | То же при `NODE_ENV=production` | Отказ (эндпоинт только для дева) |
| 1.3 | `POST /api/auth/refresh` с refresh-токеном из 1.1 | `200`, новая пара токенов |
| 1.4 | `POST /api/auth/refresh` с тем же refresh повторно | Отказ (ротация) |
| 1.5 | `POST /api/auth/google` с мусорным `idToken` | `401`, код `INVALID_GOOGLE_TOKEN` |
| 1.6 | `GET /api/users/me` без заголовка `Authorization` | `401` |
| 1.7 | `GET /api/users/me` с `Bearer $TOKEN` | `200`, тот же `userId`, что напечатал скрипт |

```bash
curl -s localhost:3000/api/users/me -H "Authorization: Bearer $TOKEN"
```

---

## 2. Привязка кошельков [локально]

EVM-адрес обязателен — это получатель выплаты. Подписи здесь нет, всё
приезжает как `verified: false`.

```bash
curl -s -X POST localhost:3000/api/wallets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"wallets\":[{\"chain\":\"EVM\",\"srcChainId\":1,\"address\":\"$ADDR\",\"path\":\"m/44'/60'/0'/0/0\"}]}"
```

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 2.1 | Запрос выше | `201`, адрес привязан, `verified: false`, помечен primary |
| 2.2 | Повторить тот же запрос | Идемпотентно, без ошибки и без дубля в `wallets` |
| 2.3 | Тот же чейн, но **другой** адрес | `400`, нужен явный сброс |
| 2.4 | Тот же адрес от второго пользователя (второй `npm run dev:token other-sub`) | `409`, `ADDRESS_ALREADY_LINKED` |
| 2.5 | Тело без EVM-записи (только BTC) | `400`, `NO_PRIMARY_WALLET` |
| 2.6 | `chain: "EVM"`, но `srcChainId` от биткоина | `400`, `CHAIN_MISMATCH` |
| 2.7 | `address: "0xzzz"` | `400`, `INVALID_ADDRESS` |
| 2.8 | Массив из 9 записей | `400` (максимум 8) |
| 2.9 | `GET /api/wallets` | Список привязанных адресов, primary помечен |

---

## 3. Резервная копия секретов [локально]

Сервер хранит **только шифротекст**. Проверяем, что он не даёт ослабить KDF.

Сначала забрать пол из конфига:

```bash
curl -s localhost:3000/api/config | jq .secretsKdfFloor
```

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 3.1 | `PUT /api/secrets/entropy` с `kdf {algo:argon2id, m:65536, t:3, p:1}`, `metadata.address = $ADDR` | `200`, блоб сохранён |
| 3.2 | То же с `m: 4096` | `400`, `WEAK_KDF_PARAMS` |
| 3.3 | То же с `algo: "pbkdf2"` | `400` |
| 3.4 | `metadata.address` — чужой адрес | Отказ: адрес должен быть primary EVM пользователя |
| 3.5 | `ciphertext` длиннее лимита формата (entropy > 128 b64) | `400` |
| 3.6 | `PUT /api/secrets/seed` валидным блобом | `200` |
| 3.7 | `GET /api/secrets/entropy` | `200`, ровно тот же шифротекст и параметры KDF |
| 3.8 | `GET /api/secrets/entropy` 6 раз за час | 6-й — `429` (лимит 5/час) |
| 3.9 | После каждого чтения смотреть таблицу лога доступа | Записан и промах, и попадание |
| 3.10 | `DELETE /api/secrets`, затем `GET /api/secrets/seed` | `404`: удалены оба блоба и обёрнутый ключ |

Отдельно: в логах приложения не должно быть ни шифротекста, ни адреса
целиком — грепнуть вывод на подстроку из `ciphertext`.

---

## 4. Появление платежа и начисление купона

Купоны создаёт **только** поллер платежей — `POST /transactions` купон не
выдаёт (запись от устройства это утверждение о чейне, не право на деньги).
Два способа получить купон.

### Вариант A. Через индексер [нужен индексер]

1. Добавить мерчанта, за которым следит поллер:

```sql
INSERT INTO merchants (name, "srcChainId", address, token, active)
VALUES ('qa-merchant', 1, '0x<адрес мерчанта>', 'USDT', true);
```

2. Отправить USD₮ с адреса `$ADDR` на адрес мерчанта в mainnet.
3. Прогнать пайплайн одним проходом:

```bash
npm run poll:once     # ingest → pricing → accrual
```

| # | Что проверяем | Ожидаем |
| - | ------------- | ------- |
| 4.1 | `payments` после первого прогона | Строка со `status = pending`, заполнены `txHash`, `blockNumber`, `merchantAddress` |
| 4.2 | `poll:once` до достижения глубины из `CONFIRMATION_DEPTHS` | Статус всё ещё `pending` |
| 4.3 | `poll:once` после достижения глубины | `status = confirmed`, проставлен `confirmedAt` |
| 4.4 | `price_snapshots` | Появился снимок на тот же `paymentRef` |
| 4.5 | `coupons` | Купон в статусе `ISSUED`, `value` = 5 % от суммы (`CASHBACK_BPS=500`) |
| 4.6 | Запустить `poll:once` ещё раз | Второго купона на тот же `paymentRef` нет (идемпотентность) |
| 4.7 | Платёж на адрес, не привязанный ни к кому | `userId` пустой, купон не создан |

### Вариант B. Фикстура в БД [локально]

Когда индексер недоступен, платёж можно завести руками. `paymentRef` считается
через keccak, поэтому его надо получить из кода, а не придумывать:

```bash
npx ts-node -r tsconfig-paths/register -e \
  "import('@/chains').then(c => console.log(c.paymentRef(1, '0x' + '11'.repeat(32), 0)))"
```

```sql
INSERT INTO payments
  ("paymentRef", "srcChainId", "txHash", "outputIndex", "blockNumber",
   token, amount, "fromAddress", "merchantAddress", "userId", status,
   "transferredAt", "lastSeenAt", "confirmedAt")
VALUES
  ('<paymentRef из команды выше>', 1, '0x1111...11', 0, 21000000,
   'USDT', '100000000', '<$ADDR>', '0x<мерчант>', '<userId>', 'confirmed',
   now(), now(), now());
```

Дальше `npm run poll:once` — pricing сделает снимок цены, accrual выпустит купон.

---

## 5. Купоны [локально]

| # | Запрос | Ожидаем |
| - | ------ | ------- |
| 5.1 | `GET /api/coupons` | Купон из шага 4, статус `ISSUED` |
| 5.2 | `GET /api/coupons` при купоне на неподтверждённом платеже | Статус `PENDING` и живой счётчик подтверждений |
| 5.3 | `GET /api/coupons/:id` | Тот же купон |
| 5.4 | `GET /api/coupons/by-code/:code` | Тот же купон по коду |
| 5.5 | `GET /api/coupons/by-code/НЕСУЩЕСТВУЮЩИЙ` | `404` |
| 5.6 | `GET /api/coupons/:id` чужим токеном | `404`/`403`, но не чужие данные |

```bash
export COUPON=$(curl -s localhost:3000/api/coupons -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].code')
```

---

## 6. Claim: челлендж и подпись [локально]

Пользователь подписывает ровно один раз — на экране клейма.

```bash
curl -s "localhost:3000/api/claims/challenge?coupon=$COUPON" \
  -H "Authorization: Bearer $TOKEN"
# -> { challengeId, nonce, message, expiresAt }

npm run dev:token sign <nonce> $COUPON
# -> message, signature
```

```bash
curl -s -X POST localhost:3000/api/claims \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: qa-claim-1" \
  -d "{\"challengeId\":\"<id>\",\"signature\":\"<signature>\",\"code\":\"$COUPON\"}"
```

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 6.1 | `GET /api/claims/preview` до клейма | Купон в claimable, посчитан общий UTL, показан кулдаун |
| 6.2 | Челлендж + подпись + `POST /api/claims` | `202`, клейм поставлен в очередь, купон уходит в `PENDING_ATTESTATION` |
| 6.3 | Повтор `POST /api/claims` с тем же `Idempotency-Key` | Тот же ответ, второй клейм не создан |
| 6.4 | Повтор без `Idempotency-Key` | `409`: купон уже клеймится |
| 6.5 | Тот же `challengeId` второй раз | Отказ — nonce одноразовый |
| 6.6 | Подпись **чужим** ключом | Отказ: recover не даёт primary EVM-адрес пользователя |
| 6.7 | Подпись валидная, но от челленджа другого купона | Отказ (код купона вшит в сообщение) |
| 6.8 | Клейм после `expiresAt` челленджа | Отказ по сроку |
| 6.9 | `signature` длиной не 65 байт | `400` на валидации DTO |
| 6.10 | Ни `code`, ни `couponId` | `400` |
| 6.11 | Второй клейм раньше `CLAIM_COOLDOWN_HOURS` | Отказ по кулдауну, `preview` показывает время следующего |
| 6.12 | Таблица `wallets` после успешного клейма | Адрес стал `verified: true` |
| 6.13 | Тот же адрес, ранее задекларированный другим юзером | Переезжает к тому, кто подписал (доказательство > декларации) |

---

## 7. Аттестации, релей, settlement [нужна Sepolia]

Три независимых процесса, у каждого свой env-файл, свой RPC и свой ключ.

```bash
ISSUER_ENV_FILE=.env.issuer-a npm run issue:once     # проверить и подписать
RELAYER_ENV_FILE=.env.relayer npm run relay:once     # preflight + claim() + чек receipt
SETTLEMENT_ENV_FILE=.env.settlement npm run settlement
```

| # | Что проверяем | Ожидаем |
| - | ------------- | ------- |
| 7.1 | `issue:once` от одного эмитента | Строка в `attestations`, купон ещё не `ATTESTED` (нужен порог `ATTESTATION_THRESHOLD`) |
| 7.2 | Повторить с `.env.issuer-b` (другой ключ, другой RPC) | Порог собран, купон `ATTESTED` |
| 7.3 | Тот же эмитент дважды | Второй аттестации нет |
| 7.4 | `GET /api/claims/:id` в процессе | Виден прогресс аттестаций (сколько из скольких) |
| 7.5 | Эмитент без RPC для чейна платежа | Отказ `NO_NODE`, а не запрос в чужую ноду |
| 7.6 | Сумма в аттестации против `test/fixtures/accrual/golden-amounts.json` | Совпадает байт в байт |
| 7.7 | `relay:once` | Транзакция `claim()` в Sepolia, купон `CLAIM_SUBMITTED`, сохранён txHash |
| 7.8 | `relay:once` при газе выше `RELAYER_MAX_FEE_GWEI` | Не отправляет, ждёт |
| 7.9 | `relay:once` ближе к дедлайну, чем `RELAYER_DEADLINE_MARGIN_SECONDS` | Не отправляет |
| 7.10 | Settlement-воркер после подтверждения | Пойман `Claimed`, строка в `settlements`, купон `CLAIMED` |
| 7.11 | `GET /api/claims/:id` в конце | Терминальный статус, txHash, количество аттестаций |
| 7.12 | `GET /api/claims` | Клейм в списке, пагинация по 10 |
| 7.13 | `GET /api/claims/preview` после клейма | Купон ушёл из claimable, включился кулдаун |
| 7.14 | `npm run monitor:pause-drill -- --check` | Гардиан реально может вызвать `pause()` |
| 7.15 | Монитор при расхождении эмиссии с платежами | Алерт (и авто-пауза при `MONITOR_AUTO_PAUSE=true`) |

---

## 8. Транзакции [локально]

```bash
curl -s -X POST localhost:3000/api/transactions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: qa-tx-1" \
  -d "{\"chain\":\"EVM\",\"srcChainId\":1,\"txHash\":\"0x$(printf '22%.0s' {1..32})\",
       \"direction\":\"out\",\"token\":\"USDT\",\"amount\":\"1000000\",
       \"from\":\"$ADDR\",\"to\":\"0x<мерчант>\",
       \"fee\":{\"token\":\"ETH\",\"amount\":\"210000000000000\"}}"
```

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 8.1 | Запрос выше | `201`, строка `status: PENDING`, `source: CLIENT` |
| 8.2 | Повтор с тем же `Idempotency-Key` | Тот же ответ, дубля нет |
| 8.3 | Повтор без ключа, но с тем же `txHash` | Тот же ряд по `UNIQUE (srcChainId, txHash, outputIndex)` |
| 8.4 | Тот же `txHash` от другого пользователя | Отказ, чужую строку не отдаём |
| 8.5 | `txHash: "0x123"` | `400`, `INVALID_TX_HASH` |
| 8.6 | `amount: "1.5"` | `400` — только целое в минимальных единицах, строкой |
| 8.7 | `from` — не привязанный кошелёк | Отказ по мисматчу кошелька |
| 8.8 | Ждать дольше `TX_OBSERVATION_TIMEOUT_MS` без подтверждения на чейне | Свип переводит в `FAILED` с `NOT_OBSERVED` |
| 8.9 | Строка от поллера с тем же хешем | Обновляет клиентскую строку на месте, не плодит вторую |
| 8.10 | `GET /api/transactions` | 10 на странице, курсорная пагинация, `nextCursor` |
| 8.11 | Пройти по `cursor` до конца | Без дублей и пропусков, `nextCursor` пустой |
| 8.12 | `GET /api/transactions?status=PENDING&chain=EVM&srcChainId=1` | Фильтры работают вместе |
| 8.13 | `GET /api/transactions/:id` | Одна транзакция, счётчик подтверждений растёт между опросами |
| 8.14 | `GET /api/transactions/:id` чужой транзакции | Не отдаёт данные |
| 8.15 | 31 `POST /api/transactions` за час | 31-й — `429` (лимит 30/час) |

---

## 9. Балансы [локально]

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 9.1 | `GET /api/balances` | `200`, у каждого элемента `observedAt`, `stale`, в ответе `ttlSeconds` |
| 9.2 | Замерить время ответа | Быстро: отдаётся из кеша, синхронного похода в индексер нет |
| 9.3 | Повтор после истечения `BALANCE_CACHE_TTL_MS` | `stale: true`, запускается фоновое обновление |
| 9.4 | Повтор ещё раз спустя `ttlSeconds` | Свежие данные, `stale: false` |
| 9.5 | Пользователь без привязанных кошельков | Пустой список, не ошибка |
| 9.6 | Индексер лежит | Отдаётся последнее известное значение со `stale: true`, `5xx` нет |

---

## 10. Сквозные проверки безопасности

| # | Что делаем | Ожидаем |
| - | ---------- | ------- |
| 10.1 | Любой защищённый маршрут без токена | `401` |
| 10.2 | То же с протухшим JWT | `401`, `TOKEN_EXPIRED` |
| 10.3 | То же с JWT, подписанным чужим секретом | `401` |
| 10.4 | Читать чужие купоны/клеймы/транзакции по id | Ничего чужого не возвращается |
| 10.5 | Грепнуть логи на приватный ключ, мнемонику, шифротекст | Пусто |
| 10.6 | `SELECT * FROM signers` | Только адреса, ни одного приватного ключа |
| 10.7 | Роли из `docs/db-roles.sql`: эмитент вставляет купон | Отказ по правам |
| 10.8 | Те же роли: релеер вставляет аттестацию | Отказ по правам |
| 10.9 | `ISSUER_SIGNING_KEY` в виде `env:0x...` вне дева | Отказ на старте |
| 10.10 | `kms:<arn>` в качестве ключа | Явно не реализовано (не заглушка, которая делает вид) |

---

## 11. Регрессия перед релизом

```bash
npm run lint
npm test                # 324 теста, 36 сьютов
npm run verify:signer   # реальный путь подписи WDK, вне Jest
npm run build
npm run migration:generate -- src/database/migrations/Drift   # должно быть «no changes»
```

| # | Что проверяем | Ожидаем |
| - | ------------- | ------- |
| 11.1 | `npm test` | Всё зелёное |
| 11.2 | Дрифт-тесты `payment-ref.spec.ts`, `entitlement.spec.ts` | Совпадение с фикстурами репозитория контрактов (фикстуры не править!) |
| 11.3 | Тесты изоляции | В графе модулей эмитента нет клиента индексера и контроллеров |
| 11.4 | `migration:generate` на чистой БД | «No changes» — сущности и SQL не разъехались |
| 11.5 | `npm run verify:signer` | Подпись сходится с фикстурой контрактов |

---

## Известные ограничения стенда

- **Не-EVM платежи** (BTC, Tron, Spark) индексируются, но ни один эмитент их не
  верифицирует без ноды соответствующего типа — такие клеймы отклоняются.
- **`transactions` и `balances` не покрыты юнит-тестами** — разделы 8 и 9
  проверяются только руками.
- **Миграции идут на старте** (`migrationsRun: true`): две реплики,
  поднятые одновременно, гонятся за таблицу миграций.
- **`POST /auth/session` и `GET /me`** из референса не реализованы; та же
  функциональность — `/auth/google` и `/users/me`.
