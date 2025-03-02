using Services.Grid;

namespace Services.Turn
{
    public class TurnPhaseEnemy : TurnPhase 
    {
        private GridService _gridService = ServiceLocator.Get<GridService>();

        public override void Prepare()
        {
            _preparePhase();
        }
        
        protected override void _preparePhase()
        {
            base._preparePhase();

            _phases.Clear();
            _phases.Enqueue(_enemiesActionPhase);
        }
        
        private async void _enemiesActionPhase()
        {
            var enemies = _gridService.GetEnemies();
            if (enemies == null)
            {
                _processNextPhase();
                return;
            }

            foreach (var enemy in enemies)
            {
                // Есть вероятность, что цель будет уничтожена раньше
                if (enemy.Health.IsDead) continue;

                await enemy.ExecuteAbilities();
            }
            
            _processNextPhase();
        }
    }
}