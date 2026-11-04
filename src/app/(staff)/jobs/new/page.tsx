import { JobForm } from '@/components/forms';
import { PageHeader,Setup } from '@/components/ui';
import { configured } from '@/lib/config';
import { pageStaff } from '@/lib/view';
export default async function NewJob(){if(!configured())return <Setup/>;await pageStaff();return <><PageHeader eyebrow="JOBS / NEW OPPORTUNITY" title="Create a job" description="Define the role. Then invite the right people to apply."/><JobForm/></>;}
