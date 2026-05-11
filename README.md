# E23CSEU0400

This repository contains my submission for the Affordmed evaluation assignment. The project is built using TypeScript and focuses on concepts like logging middleware, notification prioritization, scheduling logic, and basic system design.

The overall goal of the assignment was to build small backend-focused modules that interact with APIs, process data, and demonstrate clean problem-solving approaches.

---

# Project Structure

## `logging_middleware/`

This folder contains a reusable logging middleware package written in TypeScript.

The middleware is responsible for:
- Sending logs to the evaluation logging API
- Supporting different log levels
- Keeping logs structured and easy to track

The logger was kept modular so it can be reused in other backend projects as well.

---

## `priority_inbox.ts`

This script handles the Priority Inbox task.

It:
- Fetches notifications from the API
- Assigns priorities based on notification type
- Sorts notifications using score and timestamp
- Displays the Top 10 most important notifications

The idea behind this task was to simulate how modern apps prioritize important updates over regular notifications.

---

## `vehicle_scheduling.ts`

This file contains the vehicle scheduling implementation.

The program:
- Fetches depot and task information
- Uses a knapsack-style optimization approach
- Selects tasks based on maximum impact within available working hours
- Displays scheduling results for each depot

This task mainly focuses on optimization and resource allocation logic.

---

## `notification_system_design.md`

This markdown file contains short written explanations for the notification system design stages provided in the assignment.

It includes:
- Basic design ideas
- Notification flow concepts
- Priority handling
- Scalability considerations
- Simple architectural explanations

---

# Technologies Used

- TypeScript
- Node.js
- Axios
- REST APIs
- Git & GitHub
