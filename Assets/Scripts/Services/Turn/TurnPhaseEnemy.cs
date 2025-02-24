using DG.Tweening;
using Services.Grid;

namespace Services.Turn
{
    public class TurnPhaseEnemy : TurnPhase 
    {
        private GridService _gridService = GridService.Instance;

        public override void StartPhase()
        {
            _preparePhase();
            _processNextPhase();
        }
        
        protected override void _preparePhase()
        {
            base._preparePhase();

            _turnPhases.Clear();
            _turnPhases.Enqueue(_enemiesActionPhase);
        }
        
        private void _enemiesActionPhase()
        {
            var enemies = _gridService.GetEnemies();
            if (enemies == null || enemies.Length == 0)
            {
                _processNextPhase();
                return;
            }

            var index = 0;

            ExecuteNext();
            return;

            void ExecuteNext()
            {
                if (index >= enemies.Length)
                {
                    _processNextPhase();
                    return;
                }

                var enemy = enemies[index++];
                if (enemy == null)
                {
                    ExecuteNext(); // Пропускаем null-объекты
                    return;
                }

                var tween = enemy.ExecuteAbilities();
                tween.OnComplete(ExecuteNext);
            }
        }
    }
}