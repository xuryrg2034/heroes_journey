using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Entities.Components;
using UnityEngine;

namespace Entities.Player
{
    [Serializable]
    public class ChainingAttackSelection : BaseAbility
    {
        [SerializeField] private int killsToReward;
        
        [SerializeField] private BaseEntity rainbowCoinPrefab;
        
        public readonly List<BaseEntity> SelectedEntities = new();
        
        private ChainingAttackState _currentState = ChainingAttackState.Pending;

        private EntitySelectionType _availableSelectionType = EntitySelectionType.Neutral;

        private int _totalDamage;
        
        private bool _selectionLocked;
        
        private Animator _animator;

        private int _nextIndex;

        public int Damage { get; private set; }
        
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

        // Вся логика выделения противников мутная, стоит потом пройтись свежим взглядом
        public override void SelectTarget(BaseEntity entity)
        {
            if (entity.GridPosition == Hero.GridPosition)
            {
                _resetSelection();
                _totalDamage = 0;
                _updateHeroPower();
                return;
            }

            if (SelectedEntities.Contains(entity))
            {
                _removeEnemiesAfter(entity);
                _totalDamage = SelectedEntities.Sum(item =>
                {
                    if (item.Health.Value == 0)
                    {
                        return 1;
                    }

                    return -item.Health.Value;
                });

                _selectionLocked = _totalDamage < 0;
                _updateHeroPower();
                return;
            }

            var originPosition = SelectedEntities.Count > 0 ? SelectedEntities.Last().GridPosition : Hero.GridPosition;
            var isInRange = _isInRange(originPosition, entity.GridPosition);
            var canSelection = _canSelectionTypeByType(entity);
            
            if (!isInRange || !canSelection || _selectionLocked) return;
            
            // Проверка, что бы нельзя было добавить в цепочку противка у которого больше 0 здоровья, когда нет урона
            if (entity.Health.Value > 0 && _totalDamage <= 0) return;
            
            SelectedEntities.Add(entity);
            
            _availableSelectionType = entity.SelectionType;
            // _highlightTarget(baseEntity.Cell, true);

            if (entity.Health.Value == 0)
            {
                _totalDamage += 1;
                _selectionLocked = false;
            }
            else
            {
                _totalDamage -= entity.Health.Value;
                _selectionLocked = _totalDamage < 0;
            }

            _updateHeroPower();
        }

        public override async UniTask Execute()
        {
            await base.Execute();

            _currentState = ChainingAttackState.Process;
            Next();

            await UniTask.WaitUntil(() => _currentState == ChainingAttackState.End);
             
            _resetSelection();
            
            _currentState = ChainingAttackState.Pending;
        }

        public void Next()
        {
            var entity = SelectedEntities[_nextIndex];
            var animationDirection = _nextAnimationName(entity.GridPosition);
            
            Hero.Animator.SetInteger("Side Attack", animationDirection);
        }

        // Вся калькуляция урона отстой
        public async UniTask AnimationEnd()
        {
            Hero.Animator.SetInteger("Side Attack", -1);
            var entity = SelectedEntities[_nextIndex];
            var entityHealth = entity.Health.Value;

            if (entityHealth == 0)
            {
                Damage += 1;
            }
            
            Damage -= entityHealth;
            
            if (entity.Health.IsDead)
            {
                await Hero.Move(entity.GridPosition, 0.1f);

                _nextIndex++;
            }
            
            if (_nextIndex >= SelectedEntities.Count)
            {
                _currentState = ChainingAttackState.End;
            }
            else
            {
                Next();    
            }
        }

        public override void Cancel()
        {
            _resetSelection();
        }

        private int _nextAnimationName(Vector3Int entityPosition)
        {
            var start = Hero.GridPosition;
            var delta = entityPosition - start;

            if (Mathf.Abs(delta.x) > Mathf.Abs(delta.y))
            {
                // Right / Left
                return delta.x > 0 ? 1 : 3;
            }
            else
            {
                // Top / Down
                return delta.y > 0 ? 0 : 2;
            }
        }

        private bool _canSelectionTypeByType(BaseEntity baseEntity)
        {
            if (
                baseEntity.SelectionType == EntitySelectionType.Neutral
                || _availableSelectionType == EntitySelectionType.Neutral
            ) return true;

            return baseEntity.SelectionType == _availableSelectionType;
        }
        
        private void _removeEnemiesAfter(BaseEntity target)
        {
            var index = SelectedEntities.IndexOf(target);
            if (index < 0) return;

            for (var i = SelectedEntities.Count - 1; i > index; i--)
            {
                SelectedEntities.RemoveAt(i);
            }
            
            _availableSelectionType = SelectedEntities.Last().SelectionType;
        }
        
        private void _resetSelection()
        {
            SelectedEntities.Clear();
            _availableSelectionType = EntitySelectionType.Neutral;
            _selectionLocked = false;
            _nextIndex = 0;
            _totalDamage = 0;
            _updateHeroPower();
        }

        // TODO: Надо удалить. Нет смысла изменять силу героя. Сила этой абилки, копится внутри нее самой
        // TODO: Выводить счетчик накопленной силы
        private void _updateHeroPower()
        {
            Hero.Damage.SetValue(_totalDamage < 0 ? 0 : _totalDamage);
        }
        
        private void _checkComboReward()
        {
            // var excludeCells = _selectedEntities.Select(e => e.Cell).ToList();
            // var gridService = ServiceLocator.Get<GridService>();
            // var cell = gridService.GetRandomCell(excludeCells);
            
            // gridService.SpawnEntity(rainbowCoinPrefab, cell);
        }

        protected bool _isInRange(Vector3Int origin, Vector3Int target)
        {
            // Вычисляем разницу по X и Y
            var deltaX = Math.Abs(origin.x - target.x);
            var deltaY = Math.Abs(origin.y - target.y);

            return (deltaX == 1 && deltaY == 0) || (deltaX == 0 && deltaY == 1);
        }
    }
}