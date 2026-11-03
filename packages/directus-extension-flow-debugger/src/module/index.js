import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";

export default defineModule({
  id: "flow-debugger",
  name: "Flow Debugger",
  icon: "bug_report",
  routes: [
    {
      path: "",
      component: ModuleComponent
    }
  ],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
