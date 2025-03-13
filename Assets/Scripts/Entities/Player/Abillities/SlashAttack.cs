using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Entities.Components;
using Grid;
using Services;
using Services.EventBus;
using UnityEngine;

namespace Entities.Player
{
    [Serializable]
    public class SlashAttack : BaseAbility
    {
        [SerializeField] private int baseDamage; 
        private int _damage = 0;

        private List<BaseEntity> _selectedTargets = new();

        private GridService _gridService;

        private static List<Vector3> _directions = new()
        {
            new Vector3(1, 0, 0), // 0° - вправо
            new Vector3(1, 1, 0), // 45° - вверх-вправо
            new Vector3(0, 1, 0), // 90° - вверх
            new Vector3(-1, 1, 0), // 135° - вверх-влево
            new Vector3(-1, 0, 0), // 180° - влево
            new Vector3(-1, -1, 0), // 225° - вниз-влево
            new Vector3(0, -1, 0), // 270° - вниз
            new Vector3(1, -1, 0), // 315° - вниз-вправо
        };

        public override void Init(Hero hero)
        {
            base.Init(hero);

            _gridService = ServiceLocator.Get<GridService>();
            _damage = Hero.Damage.Value;
        }
        
        public override void Activate()
        {
            base.Activate();

            ClickHandler.OnEntityClicked.AddListener(SelectTarget);
        }

        public override void Deactivate()
        {
            base.Deactivate();
            
            ClickHandler.OnEntityClicked.RemoveListener(SelectTarget);

            _resetSelection();
        }
        
        public override void SelectTarget(BaseEntity baseEntity)
        {
            if (baseEntity == Hero)
            {
                _resetSelection();
                return;
            }

            var isInRange = _isInRange(Hero.transform.position, baseEntity.transform.position, 1);

            if (!isInRange) return;

            _resetSelection();
            
            var targetPositions = _getEntitiesCoords(Hero.transform.position, baseEntity.transform.position);
            
            foreach (var position in targetPositions)
            {
                var target = _gridService.GetEntityAt(position);
            
                if (!target) continue;
                
                _selectedTargets.Add(target);
                // _highlightTarget(target.Cell, true);
            }
        }

        public override async UniTask Execute()
        {
            await base.Execute();
            
            var tasks = new List<UniTask>();
            
            foreach (var target in _selectedTargets)
            {
                var task = target.Health.TakeDamage(baseDamage + _damage);
                
                tasks.Add(task);
            }
            
            await UniTask.WhenAll(tasks);

            _checkComboReward(_selectedTargets);
            _resetSelection();
        }
        
        public override void Cancel()
        {
            // throw new NotImplementedException();
        }

        private void _resetSelection()
        {
            // foreach (var target in _selectedTargets)
            // {
            //     _highlightTarget(target.Cell, false);
            // }
            
            _selectedTargets.Clear();
        }

        private List<Vector3> _getEntitiesCoords(Vector3 originPos, Vector3 targetPos)
        {
            var targets = new List<Vector3>();
            // Вектор от героя до клика
            var attackVec = targetPos - originPos;
            var angle = Mathf.Atan2(attackVec.y, attackVec.x) * Mathf.Rad2Deg;

            if (angle < 0) angle += 360;

            // Округляем угол до ближайших 45 градусов (8 направлений)
            var index = Mathf.RoundToInt(angle / 45f) % 8;
            var attackDir = _directions[index];
            // Округляем позицию героя до ячеек сетки

            // Центральная ячейка атаки
            var centerCell = originPos + attackDir;
            Vector3 leftCell, rightCell;

            // Для диагональных направлений берем соседей так, чтобы они вместе с центром формировали "треугольник"
            if (attackDir.x != 0 && attackDir.y != 0)
            {
                leftCell = new Vector3(originPos.x + attackDir.x, originPos.y, 0);
                rightCell = new Vector3(originPos.x, originPos.y + attackDir.y, 0);
            }
            else // для кардинальных направлений – берём ячейки по перпендикуляру от направления
            {
                if (attackDir.x == 0) // вверх или вниз
                {
                    leftCell = centerCell + Vector3.left;
                    rightCell = centerCell + Vector3.right;
                }
                else // влево или вправо
                {
                    leftCell = centerCell + Vector3.up;
                    rightCell = centerCell + Vector3.down;
                }
            }

            targets.Add(centerCell);
            targets.Add(leftCell);
            targets.Add(rightCell);
            
            return targets;
        }
        
        private void _checkComboReward(List<BaseEntity> entities)
        {
            if (entities.Count < 3) return;
            var isCompleteCondition = entities.All(e => e.Health.IsDead && e.SelectionType == entities[0].SelectionType);

            if (isCompleteCondition)
            {
                EventBusService.Trigger(Actions.PlayerRestoreEnergy, 1);
            }
        }
    }
}