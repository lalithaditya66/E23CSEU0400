# Notification System Design

## Stage 1

### Part A - API Endpoints

- `GET /api/v1/notifications` - returns all notifications for the logged-in student.
- `GET /api/v1/notifications/{id}` - returns one notification by its ID.
- `POST /api/v1/notifications/{id}/read` - marks one notification as read.
- `POST /api/v1/notifications/read-all` - marks every notification for the student as read.
- `DELETE /api/v1/notifications/{id}` - deletes one notification.
- `GET /api/v1/notifications?unread=true` - returns only unread notifications.

### Part B - Notification JSON

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "studentId": "stu-1042",
  "type": "Placement",
  "message": "Your interview has been scheduled.",
  "isRead": false,
  "createdAt": "2026-05-11T10:15:00.000Z"
}
```

### Part C - Headers

- Request header: `Authorization: Bearer {token}`
- Request header: `Content-Type: application/json`
- Response header: `Content-Type: application/json`

### Part D - Real-Time Notifications

I would use Server-Sent Events because notifications only need to flow from server to browser. The browser opens one long-lived HTTP connection, and the server pushes new notification events over that connection whenever they arrive. This is simpler than WebSockets for a one-way update stream and is enough for live notification delivery.

## Stage 2

### Part A - Database Choice

PostgreSQL is the best choice here because it is reliable, ACID-compliant, and handles large notification datasets well. It supports indexes for fast lookups, scales to millions of rows, and is mature enough for a student notification system that needs stable reads and writes.

### Part B - Tables

`students`

- `id` UUID primary key
- `name` text not null
- `email` text unique not null
- `created_at` timestamp not null

`notifications`

- `id` UUID primary key
- `student_id` UUID not null references `students(id)`
- `notification_type` text not null check in (`Event`, `Result`, `Placement`)
- `message` text not null
- `is_read` boolean not null default false
- `created_at` timestamp not null

I would add a composite index on `(student_id, is_read, created_at)` so unread notifications for one student can be found quickly and sorted by time without scanning the whole table.

### Part C - Problems as Data Grows

- Without an index, searching 5 million rows is too slow, so the composite index fixes the lookup path.
- A single read-heavy database can get overloaded, so a read replica can handle SELECT traffic.
- Old notifications should be archived after about 6 months so the main table stays smaller and faster.

### Part D - SQL Queries

Unread notifications for one student:

```sql
SELECT id, notification_type, message, created_at
FROM notifications
WHERE student_id = $1 AND is_read = false
ORDER BY created_at DESC
LIMIT 20;
```

Mark all as read:

```sql
UPDATE notifications
SET is_read = true
WHERE student_id = $1 AND is_read = false;
```

Get one notification by ID:

```sql
SELECT *
FROM notifications
WHERE id = $1;
```

## Stage 3

The given query is mostly correct, but it uses `SELECT *` and has no `LIMIT`, so it fetches more data than needed and can return too many rows at once.

It is slow because the database must scan too many rows if there is no useful index on `(student_id, is_read)`, and sorting by `created_at DESC` is expensive without an index that matches the order.

I would rewrite it like this:

```sql
SELECT id, notification_type, message, created_at
FROM notifications
WHERE student_id = 1042 AND is_read = false
ORDER BY created_at DESC
LIMIT 20;
```

I would create an index on `(student_id, is_read, created_at DESC)` so the database can filter and sort in one pass.

I would not add an index on every column because indexes speed up reads but slow down inserts and updates. Each extra index also uses more disk space, so only columns used in `WHERE`, `ORDER BY`, or joins should be indexed.

Students who got a Placement notification in the last 7 days:

```sql
SELECT s.id, s.name, s.email, n.id AS notification_id, n.created_at
FROM students s
JOIN notifications n ON n.student_id = s.id
WHERE n.notification_type = 'Placement'
  AND n.created_at >= NOW() - INTERVAL '7 days'
ORDER BY n.created_at DESC;
```

## Stage 4

The first thing I would add is Redis caching. Unread notifications for each student can be stored in memory for 30 to 60 seconds, which removes repeated database hits. The tradeoff is that the data may be slightly stale for a short time.

I would also add pagination so the app only loads 20 notifications at a time. That reduces query cost immediately and keeps the UI responsive, even if a student has a very long notification history.

Read replicas are another good option because they let SELECT queries run on a separate copy of the database. The tradeoff is extra infrastructure cost and some replication lag.

Long term, real-time push using SSE is the cleanest answer because the browser receives new notifications instantly instead of polling the server.

## Stage 5

The broken bulk design has several problems. It runs one student at a time, so the whole job becomes slow. It also has weak failure handling, so one email failure can stop the full batch. It mixes database writes and email delivery together, which makes the system hard to reason about and harder to recover.

If 200 emails fail midway, I would use the logs to identify exactly which student IDs failed, then retry only those emails with exponential backoff. I would not redo the database save for those students because the in-app notification already exists.

Saving to the database and sending email should be independent operations. A failed email must not remove or block the notification inside the app.

Improved flow:

1. Save all notifications in one bulk database operation.
2. Push real-time jobs to a queue in chunks of 500 students.
3. Add all emails to a message queue.
4. Let workers process email jobs with retries.
5. Send permanently failed jobs to a dead letter queue.

## Stage 6

The priority score uses a type weight plus the notification timestamp.

- Placement = 3
- Result = 2
- Event = 1

Score formula:

```text
score = (typeWeight * 1000000000000) + unixTimestamp
```

The large multiplier makes sure type priority always beats recency. That means every Placement notification ranks above every Result notification, and every Result ranks above every Event. Inside the same type, newer timestamps rank first.

To keep only the top 10, I would use a min-heap of size 10. When a new notification comes in, I compare its score to the smallest item in the heap. If it is better, I remove the smallest item and insert the new one. That keeps memory usage tiny and gives `O(log N)` insertion time where `N = 10`.

### Heap explanation

A min-heap keeps the least important item at the top. That makes it easy to decide whether a new notification belongs in the top 10. If the heap already has 10 items and the new score is better than the weakest one, I replace that weakest item. If not, I ignore it.

### Time complexity

Each insertion or replacement in the heap takes `O(log 10)`, which is effectively constant for this assignment. The important part is that the program does not sort the full list every time a new notification arrives.



Suggested run commands (PowerShell):

```powershell
$env:DEBUG='true'
Get-Content .env | ForEach-Object {
  if ($_ -match '^\$env:([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
npm exec --yes --package ts-node@10.9.2 --package typescript@5.8.3 -- ts-node --project tsconfig.json priority_inbox.ts
npm exec --yes --package ts-node@10.9.2 --package typescript@5.8.3 -- ts-node --project tsconfig.json vehicle_scheduling.ts
```

![Stage 6 Top 10 Priority Inbox Output](./screenshots/stage6_priority_inbox_output.png)

![Vehicle Scheduling Output](./screenshots/vehicle_scheduling_output.png)
