import { Scene } from '@beland/schemas'
import { EventEmitter } from 'events'
import chalk from 'chalk'
import { ethers } from 'ethers'
import events from 'wildcards'

import { Coords } from '../utils/coordinateHelpers'
import { ErrorType, fail } from '../utils/errors'
import { BLDInfo, getConfig } from '../config'
import { debug } from '../utils/logging'
import { Preview } from './Preview'
import { createWorkspace, Workspace } from './Workspace'
import { LinkerAPI, LinkerResponse } from './LinkerAPI'

export type BelandArguments = {
  workingDir: string
  previewPort?: number
  linkerPort?: number
  isHttps?: boolean
  watch?: boolean
  config?: BLDInfo
  forceDeploy?: boolean
  yes?: boolean
}

export type AddressInfo = {
  parcels: ({ x: number; y: number } & BLDInfo)[]
  estates: ({ id: number } & BLDInfo)[]
}

export type Parcel = any & {
  owner: string
  operator?: string
  updateOperator?: string
}

export type Estate = Parcel & {
  parcels: Coords[]
}

export type ParcelMetadata = {
  scene: Scene
  land: Parcel
}

export type FileInfo = {
  name: string
  cid: string
}

export class Beland extends EventEmitter {
  workspace: Workspace
  options: BelandArguments
  wallet?: ethers.Wallet

  constructor(
    args: BelandArguments = {
      workingDir: process.cwd()
    }
  ) {
    super()
    this.options = args
    this.options.config = this.options.config || getConfig()
    console.assert(this.options.workingDir, 'Working directory is missing')
    debug(`Working directory: ${chalk.bold(this.options.workingDir)}`)
    this.workspace = createWorkspace({ workingDir: this.options.workingDir })

    if (process.env.BLD_PRIVATE_KEY) {
      this.createWallet(process.env.BLD_PRIVATE_KEY)
    }
  }

  getWorkingDir(): string {
    return this.options.workingDir
  }

  async preview() {
    for (const project of this.workspace.getAllProjects()) {
      await project.validateExistingProject()
      await project.validateSceneOptions()
    }

    const preview = new Preview(this, this.getWatch())

    events(preview, '*', this.pipeEvents.bind(this))

    await preview.startServer(this.options.previewPort!)
  }

  getWatch(): boolean {
    return !!this.options.watch
  }

  async getParcelInfo(coords: Coords): Promise<ParcelMetadata> {
    return {} as any
  }

  async getPublicAddress(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    return this.wallet?.getAddress()!
  }

  private pipeEvents(event: string, ...args: any[]) {
    this.emit(event, ...args)
  }

  private createWallet(privateKey: string): void {
    let length = 64

    if (privateKey.startsWith('0x')) {
      length = 66
    }

    if (privateKey.length !== length) {
      fail(ErrorType.DEPLOY_ERROR, 'Addresses should be 64 characters length.')
    }

    this.wallet = new ethers.Wallet(privateKey)
  }

  async getAddressAndSignature(messageToSign: string): Promise<LinkerResponse> {
    if (this.wallet) {
      const [signature, address] = await Promise.all([
        this.wallet.signMessage(messageToSign),
        this.wallet.getAddress()
      ])
      return { signature, address }
    }

    throw new Error('please export BLD_PRIVATE_KEY')
  }

  async link(rootCID: string): Promise<LinkerResponse> {
    const project = this.workspace.getSingleProject()
    if (!project) {
      throw new Error(
        'Cannot link a workspace. Please set you current directory in the project folder.'
      )
    }

    await project.validateExistingProject()
    await project.validateSceneOptions()

    return new Promise<LinkerResponse>(async (resolve, reject) => {
      const linker = new LinkerAPI(project)
      events(linker, '*', this.pipeEvents.bind(this))
      linker.on('link:success', async (message: LinkerResponse) => {
        resolve(message)
      })

      try {
        await linker.link(
          this.options.linkerPort!,
          !!this.options.isHttps,
          rootCID
        )
      } catch (e) {
        reject(e)
      }
    })
  }
}
