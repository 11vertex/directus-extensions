import { defineModule } from "@directus/extensions-sdk";
import ModuleComponent from "./module.vue";

export default defineModule({
  id: "content-dependency-graph",
  name: "Content Dependency Graph",
  icon: "account_tree",
  routes: [{ path: "", component: ModuleComponent }],
  preRegisterCheck(user) {
    return user?.admin_access === true;
  }
});
