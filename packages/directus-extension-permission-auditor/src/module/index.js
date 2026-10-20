import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";

export default defineModule({
  id: "permission-auditor",
  name: "Permission Auditor",
  icon: "policy",
  routes: [{ path: "", component: ModuleComponent }],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
