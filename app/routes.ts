import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/jotform", "routes/api.jotform.ts"),
] satisfies RouteConfig;
