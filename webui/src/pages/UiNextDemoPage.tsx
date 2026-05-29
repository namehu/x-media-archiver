import { Box, Database, Search } from "lucide-react";
import { Badge } from "../components/ui-next/badge";
import { Button } from "../components/ui-next/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui-next/card";
import { EmptyState } from "../components/ui-next/empty-state";
import { ErrorState } from "../components/ui-next/error-state";
import { Input } from "../components/ui-next/input";
import { LiveIndicator } from "../components/ui-next/live-indicator";
import { ProgressRing } from "../components/ui-next/progress-ring";
import { Skeleton } from "../components/ui-next/skeleton";
import { Sparkline } from "../components/ui-next/sparkline";
import { StatCard } from "../components/ui-next/stat-card";
import { StatusDot } from "../components/ui-next/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui-next/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui-next/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui-next/tooltip";

export function UiNextDemoPage() {
  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">ui-next preview</h1>
          <p className="mt-1 text-sm text-fg-secondary">Phase 4 token, component, and interaction sandbox.</p>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Media assets" value="12,840" detail="Indexed local media" icon={<Box className="h-4 w-4" />} sparklineData={[2, 5, 4, 8, 9, 7, 10]} trend={{ value: "+8.4%", direction: "up" }} />
          <StatCard label="Failures" value="18" detail="Needs review" icon={<Database className="h-4 w-4" />} sparklineData={[9, 7, 5, 5, 4, 3, 2]} trend={{ value: "-12%", direction: "down" }} tone="danger" />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Controls</CardTitle>
              <CardDescription>Buttons, input, badges, indicators, tooltip.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="max-w-sm">
                <Input placeholder="Search media, tweet id, author..." />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="default">brand</Badge>
                <Badge tone="success">success</Badge>
                <Badge tone="warning">warning</Badge>
                <Badge tone="danger">danger</Badge>
                <LiveIndicator state="open" label="Live events connected" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="outline" aria-label="Search">
                      <Search className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Search</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data surfaces</CardTitle>
              <CardDescription>Table, status dots, progress, skeleton.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6">
                <ProgressRing value={68} />
                <Sparkline data={[3, 6, 5, 8, 11, 10, 14]} />
                <div className="flex gap-2">
                  <StatusDot status="running" />
                  <StatusDot status="success" />
                  <StatusDot status="warning" />
                  <StatusDot status="danger" />
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Downloaded</TableCell>
                    <TableCell>12,840</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Failed</TableCell>
                    <TableCell>18</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Skeleton className="h-10" />
            </CardContent>
          </Card>
        </section>

        <Tabs defaultValue="empty">
          <TabsList>
            <TabsTrigger value="empty">Empty</TabsTrigger>
            <TabsTrigger value="error">Error</TabsTrigger>
          </TabsList>
          <TabsContent value="empty">
            <EmptyState icon={<Box className="h-5 w-5" />} title="No media matched" description="Adjust filters or submit a new archive run." />
          </TabsContent>
          <TabsContent value="error">
            <ErrorState title="API unavailable" detail="The backend did not respond to the latest request." />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
