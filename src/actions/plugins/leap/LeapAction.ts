import { Mode } from '../../../mode/mode';
import { BaseCommand, RegisterAction } from '../../base';
import { Position } from 'vscode';
import { VimState } from '../../../state/vimState';
import { configuration } from '../../../configuration/configuration';
import { LeapSearchDirection, createLeap } from './leap';
import { getMatches, generateMarkerRegex, generatePrepareRegex } from './match';
import { StatusBar } from '../../../statusBar';
import { Marker } from './Marker';
import { VimError, ErrorCode } from '../../../error';

@RegisterAction
export class LeapPrepareAction extends BaseCommand {
  modes = [Mode.Normal];
  keys = [
    ['s', '<character>'],
    ['S', '<character>'],
  ];

  public override doesActionApply(vimState: VimState, keysPressed: string[]) {
    return super.doesActionApply(vimState, keysPressed) && configuration.leap;
  }

  public override async exec(cursorPosition: Position, vimState: VimState): Promise<void> {
    if (!configuration.leap) return;

    if (this.keysPressed[1] === '\n') {
      this.execRepeatLastSearch(vimState);
    } else {
      await this.execPrepare(cursorPosition, vimState);
    }
  }

  private async execPrepare(cursorPosition: Position, vimState: VimState) {
    const direction = this.getDirection();
    const firstSearchString = this.keysPressed[1];

    const leap = createLeap(vimState, direction, firstSearchString);
    vimState.leap = leap;
    vimState.leap.previousMode = vimState.currentMode;

    const matches = getMatches(
      generatePrepareRegex(firstSearchString),
      direction,
      cursorPosition,
      vimState.document
    );

    vimState.leap.createMarkers(matches);
    vimState.leap.showMarkers();
    await vimState.setCurrentMode(Mode.LeapPrepareMode);
  }

  private execRepeatLastSearch(vimState: VimState) {
    if (vimState.leap?.leapAction) {
      vimState.leap.isRepeatLastSearch = true;
      vimState.leap.direction = this.getDirection();
      vimState.leap.leapAction.fire();
    } else {
      StatusBar.displayError(vimState, VimError.fromCode(ErrorCode.LeapNoPreviousSearch));
    }
  }

  private getDirection() {
    return this.keysPressed[0] === 's' ? LeapSearchDirection.Backward : LeapSearchDirection.Forward;
  }
}

@RegisterAction
export class LeapAction extends BaseCommand {
  modes = [Mode.LeapPrepareMode];
  keys = ['<character>'];
  override isJump = true;
  private vimState!: VimState;
  private searchString: string = '';
  public override async exec(cursorPosition: Position, vimState: VimState): Promise<void> {
    if (!configuration.leap) return;
    this.vimState = vimState;
    this.searchString = vimState.leap.firstSearchString + this.keysPressed[0];
    const markers: Marker[] = this.getMarkers(cursorPosition);

    if (markers.length === 0) {
      await this.handleNoFoundMarkers();
      return;
    }

    // 当执行到 leapAction 的时候需要记录一下
    // 这是为了重复执行上一次搜索命令
    // 只要记录了就意味着成功执行过一次搜索
    // 只要成功执行过一次搜索的话 那么当我们执行“重复上一次搜索命令”的时候才会ok
    vimState.leap.leapAction = this;

    if (markers.length === 1) {
      await this.handleOneMarkers(markers[0]);
      return;
    }

    await this.handleMultipleMarkers();
  }
  private async handleMultipleMarkers() {
    this.vimState.leap.keepMarkersBySearchString(this.searchString);
    await this.vimState.setCurrentMode(Mode.LeapMode);
  }

  private async handleOneMarkers(marker: Marker) {
    this.vimState.cursorStopPosition = marker.matchPosition;
    this.vimState.leap.cleanupMarkers();
    await this.vimState.setCurrentMode(this.vimState.leap.previousMode);
  }

  private async handleNoFoundMarkers() {
    StatusBar.displayError(
      this.vimState,
      VimError.fromCode(ErrorCode.LeapNoFoundSearchString, this.searchString)
    );
    this.vimState.leap.cleanupMarkers();
    await this.vimState.setCurrentMode(this.vimState.leap.previousMode);
  }

  private getMarkers(cursorPosition: Position) {
    if (this.vimState.leap.isRepeatLastSearch) {
      const matches = getMatches(
        generateMarkerRegex(this.searchString),
        this.vimState.leap.direction!,
        cursorPosition,
        this.vimState.document
      );
      this.vimState.leap.createMarkers(matches);
      this.vimState.leap.showMarkers();
      return this.vimState.leap.markers;
    } else {
      return this.vimState.leap.findMarkersBySearchString(this.searchString);
    }
  }

  public fire() {
    this.exec(this.vimState.cursorStopPosition, this.vimState);
  }
}
