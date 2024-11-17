import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ConfigService } from '@nestjs/config';

import * as pg from 'pg';
import { PrismaClient } from '@prisma/client';

async function runEtl(): Promise<void> {
  const userIdMap = {};
  const clientIdMap = {};
  const statusIdMap = {};
  const matterIdMap = {};

  const application = await NestFactory.createApplicationContext(AppModule);
  const config = application.get(ConfigService);
  const dumpDb = config.get<string>('DUMP_DB_URL');
  const prisma = application.get(PrismaClient);

  const client = new pg.Client(dumpDb);
  await client.connect();

  // -- DELETE ALL DATA --
  await prisma.emailSend.deleteMany();
  await prisma.pdfJob.deleteMany();
  await prisma.distributionListClient.deleteMany();
  await prisma.distributionList.deleteMany();
  await prisma.smtpConfig.deleteMany();
  await prisma.emailTemplate.deleteMany();
  await prisma.matterAssignment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.internalNote.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.matterStatus.deleteMany();
  await prisma.emailAddress.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  function createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }

    return batches;
  }

  //   Email Templates
  const dumpEmailTemplates = (
    await client.query('SELECT * from "tblEmailsToMail"')
  ).rows;

  for (const template of dumpEmailTemplates) {
    // only load users of type admin or user
    if (
      !template.emailDescription ||
      template.emailDescription === 'Test' ||
      template.emailDescription === 'Blank'
    )
      continue;

    await prisma.emailTemplate.create({
      data: {
        name: template.emailDescription,
        body: template.emailHTML,
        subjectPreText: template.pretext,
        includeClientName: template.usename,
        subjectPostText: template.posttext,
      },
    });
  }

  //   USERS
  const dumpUsers = (await client.query('SELECT * from "tblUsers"')).rows;

  for (const user of dumpUsers) {
    // only load users of type admin or user
    if (
      user.userTypeID >= 3 ||
      !user.windowslogin ||
      !user.threeLetterAbbreviation
    )
      continue;

    const newUser = await prisma.user.create({
      data: {
        username: user.windowslogin,
        email: user.email,
        role: user.userTypeID === 1 ? 'USER' : 'ADMIN',
        firstName: user.EmployeeFirstName ?? user.windowslogin,
        lastName: user.EmployeeLastName ?? user.windowslogin,
        abbreviation: user.threeLetterAbbreviation.toUpperCase(),
      },
    });
    userIdMap[user.userid] = newUser.id;
  }

  // CLIENTS

  const dumpClients = (await client.query('SELECT * from "tblClient"')).rows;

  for (const client of dumpClients) {
    if (!client.txtClientName) continue;

    const newClient = await prisma.client.create({
      data: {
        name: client.txtClientName,
        suffix: client.nameWithSuffixes
          ? client.nameWithSuffixes.replace(client.txtClientName, '')
          : undefined,
        type: client.clientType === 1 ? 'ASSOCIATION' : 'NON_ASSOCIATION',
        deletedAt: !client.active ? new Date() : undefined,
      },
    });

    clientIdMap[client.idnClient] = newClient.id;
  }

  // Emails

  const dumpEmails = (await client.query('SELECT * from "tblEmailAddresses"'))
    .rows;

  for (const email of dumpEmails) {
    if (!email.membername || !email.memberemail) continue;

    await prisma.emailAddress.create({
      data: {
        clientId: clientIdMap[email.clientid],
        memberName: email.membername,
        email: email.memberemail,
        shouldSendReport: email.sendreport,
      },
    });
  }

  // MatterStatus

  const dumpStatuses = (await client.query('SELECT * from "tblStatus"')).rows;

  for (const status of dumpStatuses) {
    const newStatus = await prisma.matterStatus.create({
      data: {
        status: status.status,
      },
    });
    statusIdMap[status.statusID] = newStatus.id;
  }

  // Matters

  const dumpMatters = (await client.query('SELECT * from "tblMatters"')).rows;

  for (const matter of dumpMatters) {
    if (!clientIdMap[matter.clientid]) continue;
    const newMatter = await prisma.matter.create({
      data: {
        client: { connect: { id: clientIdMap[matter.clientid] } },
        status: { connect: { id: statusIdMap[matter.statusid] } },
        project: matter.project,
        fileNumber: matter.fileNumber,
        closedAt: matter.dateClosed,
        deletedAt: matter.wasDeleted
          ? new Date(matter.dateofLastActivity)
          : undefined,
      },
    });
    matterIdMap[matter.mattersid] = newMatter.id;

    if (matter.comments) {
      await prisma.comment.create({
        data: {
          matterId: newMatter.id,
          comment: matter.comments,
        },
      });
    }

    if (matter.assignedtoID && userIdMap[matter.assignedtoID]) {
      await prisma.matterAssignment.create({
        data: {
          createdAt: new Date(matter.assignedDate),
          assignedBy: matter.assignedby,
          matterId: newMatter.id,
          userId: userIdMap[matter.assignedtoID],
        },
      });
    }
  }

  // Internal Notes
  const dumpInternalNotes = (
    await client.query('SELECT * from "tblGeneralMattersInternalNotes"')
  ).rows
    .filter((note) => {
      const hasUser = userIdMap[note.addedbyuserid];
      const hasMatter = matterIdMap[note.generalmattersid];

      return hasUser && hasMatter;
    })
    .map((note) => {
      return {
        addedBy: userIdMap[note.addedbyuserid],
        matterId: matterIdMap[note.generalmattersid],
        note: note.Note,
        deletedAt: !note.isActive ? new Date() : undefined,
      };
    });

  const batches = createBatches(dumpInternalNotes, 100);

  for (const batch of batches) {
    await prisma.internalNote.createMany({ data: batch });
  }
}

runEtl().then((_) => process.exit());
