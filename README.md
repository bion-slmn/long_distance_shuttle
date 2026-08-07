# Matatu Booking Platform

A scalable **matatu and shuttle booking management platform** designed for SACCOs, clerks, administrators, and passengers.

The platform helps SACCOs manage vehicles, routes, bookings, queues, dispatch operations, and revenue while giving platform administrators centralized visibility across all SACCOs.

## Overview

Traditional matatu and shuttle operations often rely on paper-based booking, manual vehicle queues, and disconnected records.

This platform digitizes these operations by providing:

* Online and clerk-assisted bookings
* SACCO and vehicle management
* Route management
* Daily vehicle queues
* Vehicle clock-in and dispatch
* Booking and seat management
* Revenue tracking
* SACCO-level administration
* Platform-level administration
* Operational and system dashboards

The initial MVP focuses on making the **clerk's daily workflow faster than the traditional pen-and-paper process**.

---

## Core Users

### Super Admin

Manages the entire platform.

Responsibilities include:

* Manage SACCOs
* Manage platform users
* Monitor system activity
* View platform-wide bookings and trips
* Monitor revenue and commissions
* Monitor SACCO performance
* Manage routes and platform configuration

### SACCO Admin

Manages operations for a specific SACCO.

Responsibilities include:

* Manage vehicles
* Manage SACCO staff
* Manage routes
* Monitor bookings
* Manage daily vehicle queues
* Monitor trips and dispatches
* View SACCO revenue and operational reports

### Clerk

Handles day-to-day booking and dispatch operations.

Responsibilities include:

* Create passenger bookings
* Search bookings
* Assign bookings
* Clock vehicles into queues
* Board passengers
* Dispatch vehicles
* View queue status
* Manage operational changes

### Passenger

Passengers can:

* Search available routes
* View available trips
* Make bookings
* Receive booking information
* View booking status

---

# Main Features

## SACCO Management

The platform supports multiple SACCOs from a single system.

Each SACCO can have:

* SACCO administrators
* Clerks
* Vehicles
* Routes
* Trips
* Bookings
* Operational records

Data is scoped to the appropriate SACCO to prevent unauthorized access.

---

## Vehicle Management

SACCO administrators can manage their fleet.

Vehicle information can include:

* Registration number
* Vehicle capacity
* Vehicle status
* Assigned SACCO
* Driver information
* Operational status

Vehicles can be placed into a daily queue before being dispatched.

---

## Route Management

Routes define the journeys that vehicles operate.

A route can contain:

* Origin
* Destination
* Intermediate stages
* Fare
* SACCO
* Route status

Routes are used when creating bookings and organizing daily vehicle queues.

---

## Booking Management

The booking system allows passengers or clerks to reserve seats.

Bookings contain information such as:

* Passenger
* Contact information
* Route
* Vehicle/trip
* Seat allocation
* Fare
* Booking status
* Booking time

The platform is designed around a **fill-and-go operational model**, rather than requiring a complex seat-map system for the MVP.

---

# Queue Management

One of the core features of the platform is the daily vehicle queue.

A route can have a queue containing vehicles waiting to operate.

Example:

```text
Nairobi → Kisumu

1. KDA 123A   WAITING
2. KDB 456B   BOARDING
3. KDC 789C   WAITING
4. KDD 321D   DISPATCHED
```

### Queue States

```text
WAITING
   ↓
BOARDING
   ↓
DISPATCHED
```

The queue allows clerks to see which vehicles are:

* Waiting
* Currently boarding
* Ready for dispatch
* Already dispatched

This provides a digital replacement for the traditional physical queue.

---

# Vehicle Clock-In

When a vehicle arrives at the stage, the clerk can clock it into the route queue.

The system records:

* Vehicle
* Route
* SACCO
* Clock-in time
* Queue position
* Queue status

Existing bookings can then be associated with the appropriate operational trip.

---

# Dispatch

Once a vehicle is ready, the clerk can dispatch it.

Dispatching a vehicle records the operational event and can trigger:

* Trip creation/update
* Booking status updates
* Revenue calculations
* SACCO commission calculations
* Notifications
* Operational metrics

---

# Super Admin Dashboard

The Super Admin dashboard provides a platform-wide overview.

### Platform Metrics

* Total SACCOs
* Active SACCOs
* Trips today
* Bookings today
* Revenue today
* Active users

### System Health

* API status
* Database status
* Response time
* Failed requests
* Background job status

### Operational Insights

* Booking trends
* Top-performing SACCOs
* Popular routes
* Recent trips
* Recent platform activity

### Alerts

The dashboard can surface important issues such as:

* Failed payments
* Route without available vehicles
* Failed integrations
* System errors
* Queue problems

---

# SACCO Dashboard

The SACCO dashboard focuses on daily operations.

It can provide:

* Today's trips
* Active vehicles
* Waiting vehicles
* Boarding vehicles
* Dispatched vehicles
* Today's bookings
* Today's revenue
* Route performance
* Queue health

---

# Technology Stack

## Backend

* **NestJS**
* **TypeScript**
* **PostgreSQL**
* **TypeORM**
* **Redis**
* **BullMQ**
* **Docker**

## Frontend

* **React**
* **Vite**
* **TypeScript**
* **Tailwind CSS**
* **shadcn/ui**

## Infrastructure

* Docker
* Nginx
* Prometheus
* Grafana

---

# Architecture

The platform is designed using a modular backend architecture.

```text
                    ┌──────────────────┐
                    │     Frontend     │
                    │ React + Vite     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    API Gateway   │
                    └────────┬─────────┘
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
      ┌────────────┐  ┌────────────┐  ┌──────────────┐
      │ Admin      │  │ Booking    │  │ Integration  │
      │ Service    │  │ Service    │  │ Service      │
      └─────┬──────┘  └─────┬──────┘  └──────────────┘
            │               │
            └───────┬───────┘
                    ▼
             ┌──────────────┐
             │ PostgreSQL   │
             └──────────────┘

                    │
                    ▼
             ┌──────────────┐
             │    Redis     │
             │   BullMQ     │
             └──────────────┘
```

The architecture can be expanded into additional services as platform traffic and operational requirements grow.

---

# Project Structure

A simplified backend structure:

```text
backend/
├── src/
│   ├── auth/
│   ├── users/
│   ├── saccos/
│   ├── vehicles/
│   ├── routes/
│   ├── bookings/
│   ├── trips/
│   ├── queue/
│   ├── payments/
│   ├── notifications/
│   └── common/
│
├── migrations/
├── test/
├── Dockerfile
└── package.json
```

Frontend:

```text
frontend/
├── src/
│   ├── components/
│   ├── pages/
│   ├── layouts/
│   ├── hooks/
│   ├── services/
│   ├── types/
│   └── lib/
│
├── public/
├── Dockerfile
└── package.json
```

---

# Getting Started

## Prerequisites

Make sure you have:

* Node.js
* pnpm/npm
* PostgreSQL
* Redis
* Docker and Docker Compose

---

## Clone the Repository

```bash
git clone https://github.com/your-username/matatu-booking-platform.git

cd matatu-booking-platform
```

---

## Environment Variables

Create a `.env` file in the backend:

```env
NODE_ENV=development

PORT=3000

DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=matatu_booking

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=your-secret
```

Add additional environment variables required by payment, SMS, authentication, or other integrations.

---

# Running With Docker

Start the infrastructure:

```bash
docker compose up -d
```

Check running containers:

```bash
docker ps
```

---

# Running the Backend

Install dependencies:

```bash
pnpm install
```

Run migrations:

```bash
pnpm migration:run
```

Start development mode:

```bash
pnpm start:dev
```

The API will be available at:

```text
http://localhost:3000
```

---

# Running the Frontend

```bash
cd frontend

pnpm install

pnpm dev
```

The frontend will normally be available at:

```text
http://localhost:5173
```

---

# Core Operational Flow

The main operational workflow is:

```text
SACCO
  │
  ▼
Create Route
  │
  ▼
Vehicle Assigned
  │
  ▼
Passenger Booking
  │
  ▼
Vehicle Arrives
  │
  ▼
Vehicle Clock-In
  │
  ▼
Route Queue
  │
  ▼
Boarding
  │
  ▼
Dispatch
  │
  ▼
Trip Completed
  │
  ▼
Revenue & Reports
```

---

# Security

The platform uses role-based access control.

Example:

```text
SUPER_ADMIN
    │
    ├── Platform Management
    ├── SACCO Management
    └── System Monitoring

SACCO_ADMIN
    │
    ├── SACCO Management
    ├── Vehicle Management
    ├── Route Management
    └── Operations

CLERK
    │
    ├── Bookings
    ├── Queue Management
    ├── Boarding
    └── Dispatch
```

SACCO-scoped resources are protected so users cannot access data belonging to another SACCO unless explicitly authorized.

---

# Monitoring

The platform can use **Prometheus** and **Grafana** for infrastructure and application monitoring.

Useful metrics include:

* API request rate
* API response time
* Error rate
* Database performance
* Queue processing
* Redis health
* Server CPU usage
* Server memory usage
* Disk usage

---

# MVP Goals

The first version focuses on solving the most important operational problems:

1. Manage SACCOs
2. Manage vehicles
3. Manage routes
4. Manage users and permissions
5. Create and manage bookings
6. Manage daily vehicle queues
7. Clock vehicles in
8. Board passengers
9. Dispatch vehicles
10. Track revenue
11. Provide SACCO and Super Admin dashboards

More advanced functionality can be introduced after validating the core workflow with SACCOs and clerks.

---

# Future Improvements

Potential future features include:

* M-Pesa integration
* SMS notifications
* WhatsApp notifications
* Passenger mobile application
* Driver application
* Real-time vehicle tracking
* Digital tickets
* Automated refunds
* Advanced revenue reporting
* Route demand forecasting
* Driver performance analytics
* Automated queue optimization
* Customer notifications
* Multi-country support

---

# Project Status

**Status:** MVP / Active Development

The platform is being developed incrementally, with the initial focus on SACCO operations, booking management, vehicle queues, and dispatch workflows.

---

# License

This project is currently private/proprietary unless otherwise specified.
