# Interactive Infrastructure Map

The **Infrastructure Map** is a real-time, visual topology of your entire server ecosystem. It replaces the traditional "static list" of servers with a node-and-edge graph built using **React Flow**.

## Graph Nodes

The Map displays two primary types of nodes:

- **Project Nodes:** Represent an application (e.g., "Frontend", "Backend API").
- **Server Nodes:** Represent the physical/virtual VPS instances.

## Status Indicators

Nodes dynamically change color based on their health:

- 🟢 **Green (Pulse Glow)**: Operational and Healthy.
- 🔴 **Red (Pulsing Outline)**: Offline or Deployment Failure!

## Edges

The lines connecting the nodes represent "Deployed On" relationships. An animated dashed line means traffic or deployment relationships flow from the Project to the Provider Server.

## Interactivity

- **Drag & Drop:** You can pan the canvas, zoom in/out via the mini-map, and drag nodes around to organize your mental model.
- **Click Actions:** Clicking on a node instantly pops open a detailed side-panel with metrics (CPU, RAM, Status) for that node without navigating away from the Map.
