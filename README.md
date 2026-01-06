📦 Subscription Hub – Microservices Demo
1. Overview

Subscription Hub is a microservices-based web application that demonstrates modern distributed system concepts such as asynchronous communication, event streaming, real-time notifications, and API security.
The application allows users to subscribe to digital services (e.g., Spotify, Netflix, YouTube Premium). Subscription orders are processed asynchronously, payments are simulated, and confirmations are delivered in real time to the client application.

2. System Architecture

The system follows a microservices architecture, with each service having a clearly defined responsibility. Services communicate through a combination of REST APIs, message queues, and event streaming platforms.

Main Components

- API Gateway (Nginx + Node.js)
  - Entry point for all client requests
  - Routes traffic to internal microservices
  - Applies JWT-based authentication
- Authentication Service
  - Handles user registration and login
  - Issues JWT tokens used across the system
- Orders Service
  - Creates and manages subscription orders
  - Stores order data in MongoDB
  - Sends payment requests asynchronously
- Payments Service
  - Processes payments asynchronously
  - Publishes payment events
- Notifications Service
  - Consumes events from Kafka
  - Pushes real-time updates to clients via WebSockets
- Fraud Detection FaaS
  - Stateless function that evaluates payment risk
  - Invoked during order processing

3. Communication Patterns

The system uses multiple communication patterns to ensure scalability and loose coupling.

REST (Synchronous Communication)
- Used between the client and the API Gateway
- Used for authentication and order creation
- Secured using JWT tokens

RabbitMQ (Message Broker)
- Used for command-based asynchronous communication
- The Orders service sends payment requests to a queue
- The Payments service consumes and processes these requests independently

This approach ensures that order creation is not blocked by payment processing.

4. Event Streaming with Kafka

Kafka is used for event-based communication within the system.

- Payment confirmation events are published to a Kafka topic
- Multiple services can consume the same event independently
- Enables scalability and extensibility (e.g., audit logging, notifications)

Kafka is particularly suited for broadcasting state changes across services.

5. Real-Time Notifications

To deliver instant feedback to users, the system implements server-side notifications using WebSockets.

- The Notifications service consumes payment events from Kafka
- Events are pushed to connected clients in real time
- Users can see subscription and payment updates without refreshing the page

This improves user experience and demonstrates scalable real-time communication.

6. Fraud Detection as a Function-as-a-Service (FaaS)

The system includes a Fraud Detection Function-as-a-Service (FaaS) used to simulate basic fraud analysis during the order creation process.
This service is implemented as a lightweight, stateless HTTP service and is consumed programmatically by the Orders microservice.

Purpose
The Fraud FaaS evaluates the risk of a transaction based on the order amount and returns a fraud score.
Orders with a high fraud score are rejected before payment processing.

Implementation
- Technology: Node.js + Express
- Endpoint: POST /fraud-check
- Input:
    {
      "amount": 150
    }
- Output:
    {
      "score": 0.9
    }

A simple rule-based approach is used:
- Amount ≤ 100 → low risk
- Amount > 100 → high risk

This component follows the Function-as-a-Service model:
- Performs a single responsibility (fraud scoring)
- Is stateless
- Can be independently scaled or replaced
- Does not expose a user interface
- Is invoked on demand by another microservice

The service does not render a web page. It is designed to be consumed internally via HTTP calls.

7. Technologies Used
Backend
- Node.js
- Express.js
- MongoDB (Mongoose)
- RabbitMQ
- Apache Kafka
- WebSockets (ws)
- JWT (JSON Web Tokens)

Frontend
- HTML, CSS, JavaScript
- Micro-frontend structure (separate UI modules for users and admins)

Infrastructure
- Nginx (API Gateway & load balancing)

8. Security

- All protected endpoints require a valid JWT token
- Role-based access control is applied (admin vs. user)
- Sensitive operations (e.g., order deletion) are restricted to administrators

9. Running the Project

Each microservice runs independently and can be started separately.

Example:

- cd services/api-orders
- npm install
- node index.js

The API Gateway is accessible at:

- http://localhost:8080

10. Conclusion

Subscription Hub demonstrates key distributed system concepts including asynchronous processing, event-driven architecture, real-time communication, and service isolation.
The project serves as a practical example of building scalable and modular backend systems using modern web technologies.
