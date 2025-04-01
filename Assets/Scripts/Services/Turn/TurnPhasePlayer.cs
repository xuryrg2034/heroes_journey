using Entities.Player;
using Services.EventBus;

namespace Services.Turn
{
    public class TurnPhasePlayer : TurnPhase 
    {
        AbilitiesService _abilitiesService = ServiceLocator.Get<AbilitiesService>();

        public override void Prepare()
        {
            _preparePhase();
            EventBusService.Trigger(Actions.PlayerTurnStart);
            GameService.SetGameState(GameState.WaitingForInput);
        }

        protected override void _preparePhase()
        {
            base._preparePhase();

            _phases.Clear();
            _phases.Enqueue(_removeEnemiesPhase);
            _phases.Enqueue(_endTurn);
        }

        void _endTurn()
        {
            _abilitiesService.DeselectAbility();
            _processNextPhase();
        }

        async void _removeEnemiesPhase()
        {
            await _abilitiesService.Execute();
            _processNextPhase();
        }
    }
}