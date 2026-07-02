import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("web", {
    source: github("FrontDotFun/front"),
    build: "pnpm run build",
  });

  return project("degen", {
    resources: [web],
  });
});
